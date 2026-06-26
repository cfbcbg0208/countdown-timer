// 0-의존성 DOM 자동 검증 도구 (CDP). Node 내장 WebSocket + 설치된 Chrome/Edge만 사용.
// 목적: 매 세션 '브라우저에서 직접 확인' 수작업 왕복을 줄인다 — 헤드리스로 앱을 띄워
//       DOM 상태를 단언(assert)하고 스크린샷을 남긴다.
// 실행: node tools/cdp-verify.mjs   (성공 시 exit 0, 실패 시 1)
// 산출물: tools/.artifacts/verify.png (gitignore 권장)
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SERVE_PORT = 8129;
const DEBUG_PORT = 9333;
const BASE = `http://127.0.0.1:${SERVE_PORT}`;
const ARTIFACTS = join(import.meta.dirname, '.artifacts');

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 조건이 참이 될 때까지 폴링.
async function until(fn, { tries = 50, gap = 200, label = 'condition' } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(gap);
  }
  throw new Error(`timeout waiting for ${label}`);
}

// 최소 CDP 클라이언트(요청 id 매칭, 이벤트는 무시하고 readyState 폴링으로 대체).
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const open = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (e) => rej(new Error('ws error: ' + (e.message || ''))));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  const send = async (method, params = {}) => {
    await open;
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return { send, open, close: () => ws.close() };
}

// 페이지에서 표현식 평가 → 값 반환.
async function evalJS(client, expression) {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval: ' + r.exceptionDetails.text);
  return r.result.value;
}

let server, browser, browserProc;
const cleanup = async () => {
  try { await browser?.send('Browser.close'); } catch {}
  try { browserProc?.kill(); } catch {}
  try { server?.kill(); } catch {}
};

async function main() {
  await mkdir(ARTIFACTS, { recursive: true });

  // 1) dev 서버 기동
  server = spawn(process.execPath, [join(import.meta.dirname, '..', 'serve.mjs')], {
    env: { ...process.env, PORT: String(SERVE_PORT) },
    stdio: 'ignore',
  });
  await until(() => fetch(BASE + '/index.html').then((r) => r.ok), { label: 'dev server' });

  // 2) 헤드리스 브라우저 기동
  const bin = BROWSERS.find((p) => existsSync(p));
  if (!bin) throw new Error('Chrome/Edge 바이너리를 찾지 못함');
  const userDir = join(tmpdir(), 'cdp-verify-' + Date.now());
  browserProc = spawn(
    bin,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*', // 신형 Chrome: WS 연결 허용에 필요
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  // 3) 페이지 타깃의 WebSocket 디버거 URL 얻기
  const target = await until(
    async () => {
      const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json());
      return list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    },
    { label: 'page target' },
  );
  browser = cdp(target.webSocketDebuggerUrl);
  await browser.open;
  await browser.send('Page.enable');
  await browser.send('Runtime.enable');

  // 4) 앱으로 이동 + 로드 완료 대기
  await browser.send('Page.navigate', { url: BASE + '/' });
  await until(() => evalJS(browser, 'document.readyState === "complete"'), { label: 'load' });

  // 5) 샘플 타임카드 시드 후 리로드(미래 1개 → 진행률 바/칩 검증)
  const seed = JSON.stringify([
    {
      id: 'verify-1',
      label: '검증카드',
      targetISO: '2030-01-01T12:00:00',
      createdAt: '2026-06-27T00:00:00.000Z',
      updatedAt: '2026-06-27T00:00:00.000Z',
    },
  ]);
  await evalJS(browser, `localStorage.setItem('countdowns', ${JSON.stringify(seed)}); location.reload();`);
  await until(
    () => evalJS(browser, 'document.readyState === "complete" && document.querySelectorAll(".card").length'),
    { label: 'card render' },
  );

  // 6) 단언(assert)
  const checks = await evalJS(
    browser,
    `(() => ({
       cards: document.querySelectorAll('.card').length,
       chips: document.querySelectorAll('.card .chip').length,
       hasBar: !!document.querySelector('.card__bar-fill'),
       hasPie: !!document.querySelector('.card__pie'),
       drawerTitle: document.getElementById('drawer-title')?.textContent.trim(),
       dirChip: document.querySelector('.card__time .chip')?.textContent,
     }))()`,
  );
  const fails = [];
  if (checks.cards !== 1) fails.push(`카드 1개 기대, 실제 ${checks.cards}`);
  if (checks.chips < 3) fails.push(`칩 3개 이상 기대, 실제 ${checks.chips}`);
  if (!checks.hasBar) fails.push('진행률 바 없음');
  if (!checks.hasPie) fails.push('진행률 파이 없음');
  if (!String(checks.drawerTitle).includes('타임카드 추가')) fails.push(`드로어 제목="${checks.drawerTitle}"`);
  if (checks.dirChip !== '남은시간') fails.push(`방향 칩="${checks.dirChip}" (남은시간 기대)`);

  // 7) 스크린샷
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
  const out = join(ARTIFACTS, 'verify.png');
  await writeFile(out, Buffer.from(shot.data, 'base64'));

  console.log('검증 결과:', JSON.stringify(checks, null, 2));
  console.log('스크린샷:', out);
  if (fails.length) {
    console.error('❌ 실패:\n - ' + fails.join('\n - '));
    process.exitCode = 1;
  } else {
    console.log('✅ 모든 단언 통과');
  }
}

main()
  .catch((e) => {
    console.error('오류:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await sleep(300);
  });
