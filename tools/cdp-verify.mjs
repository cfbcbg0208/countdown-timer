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

const SERVE_PORT = 8100 + Math.floor(Math.random() * 300);
const DEBUG_PORT = 9200 + Math.floor(Math.random() * 600); // 랜덤 포트: 이전 잔존 인스턴스와 격리
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
  // 스크린샷이 2000px를 넘지 않도록 뷰포트 고정(Read로 직접 볼 수 있게).
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 820,
    height: 1180,
    deviceScaleFactor: 1,
    mobile: false,
  });

  // 4) 앱으로 이동 + 로드 완료 대기
  await browser.send('Page.navigate', { url: BASE + '/' });
  await until(() => evalJS(browser, 'document.readyState === "complete"'), { label: 'load' });

  // 5) 샘플 타임카드 시드 후 리로드(오늘 +3h = 미래·이번달 → 진행률/칩 + 캘린더 검증 둘 다)
  const t = new Date(Date.now() + 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const targetISO = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}:00`;
  const seed = JSON.stringify([
    {
      id: 'verify-1',
      label: '검증카드',
      targetISO,
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
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
       theme: document.documentElement.dataset.theme,
     }))()`,
  );
  const fails = [];
  if (checks.cards !== 1) fails.push(`카드 1개 기대, 실제 ${checks.cards}`);
  if (checks.chips < 3) fails.push(`칩 3개 이상 기대, 실제 ${checks.chips}`);
  if (!checks.hasBar) fails.push('진행률 바 없음');
  if (!checks.hasPie) fails.push('진행률 파이 없음');
  if (!String(checks.drawerTitle).includes('타임카드 추가')) fails.push(`드로어 제목="${checks.drawerTitle}"`);
  if (checks.dirChip !== '남은시간') fails.push(`방향 칩="${checks.dirChip}" (남은시간 기대)`);
  if (checks.theme !== 'dark') fails.push(`기본 테마 dark 기대, 실제 ${checks.theme}`);

  // 7) 카드 화면 스크린샷
  const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const out = join(ARTIFACTS, 'verify.png');
  await writeFile(out, Buffer.from(shot.data, 'base64'));

  // 7.5) 커스텀 진행 시작(startISO): 진행률 클릭 → 편집기 → 값 저장 → localStorage 반영
  await evalJS(browser, "document.querySelector('.card__progress')?.click()");
  await until(() => evalJS(browser, `!!document.querySelector('.card__editor[data-field="start"]')`), {
    label: 'start editor',
  });
  await evalJS(
    browser,
    `(() => { const i = document.querySelector('.card__editor .card__editinput');
       i.value = '2026-06-26 00:00:00'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );
  await evalJS(browser, "document.querySelector('.card__editor .card__save')?.click()");
  await until(
    () => evalJS(browser, "(JSON.parse(localStorage.getItem('countdowns'))[0].startISO || '').length > 0"),
    { label: 'startISO saved' },
  );
  const startISO = await evalJS(browser, "JSON.parse(localStorage.getItem('countdowns'))[0].startISO");
  if (!startISO) fails.push('커스텀 진행 시작(startISO) 저장 실패');

  // 8) 캘린더 열고 그리드 렌더 확인
  await evalJS(browser, "document.getElementById('calendar-fab').click()");
  await until(() => evalJS(browser, "document.querySelectorAll('#cal-grid .cal__day').length"), {
    label: 'calendar grid',
  });
  const cal = await evalJS(
    browser,
    `(() => ({
       open: !document.getElementById('calendar-drawer').hidden,
       weekdays: document.querySelectorAll('#cal-grid .cal__wd').length,
       days: document.querySelectorAll('#cal-grid .cal__day').length,
       month: document.getElementById('cal-month').textContent,
     }))()`,
  );
  if (!cal.open) fails.push('캘린더 안 열림');
  if (cal.weekdays !== 7) fails.push(`요일헤더 7 기대, 실제 ${cal.weekdays}`);
  if (cal.days % 7 !== 0 || cal.days < 28) fails.push(`날짜셀 7배수(28+) 기대, 실제 ${cal.days}`);
  if (!/^\d{4}년 \d{1,2}월$/.test(cal.month)) fails.push(`월 표기 형식="${cal.month}"`);
  const calShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-calendar.png'), Buffer.from(calShot.data, 'base64'));

  // 9) P4: 기준 셀렉트 + 항목 클릭 메뉴 + 날짜/단독 필터
  const p4a = await evalJS(
    browser,
    `(() => ({
       basisOpts: document.querySelectorAll('#cal-basis option').length,
       calItems: document.querySelectorAll('#cal-grid .cal__item').length,
     }))()`,
  );
  if (p4a.basisOpts !== 3) fails.push(`기준 옵션 3 기대, 실제 ${p4a.basisOpts}`);
  if (p4a.calItems < 1) fails.push('캘린더에 시드 항목이 안 보임(이번달 매핑 실패)');
  // 캘린더 항목 클릭 → 메뉴
  await evalJS(browser, "document.querySelector('#cal-grid .cal__item')?.click()");
  await until(() => evalJS(browser, "document.querySelectorAll('.item-menu__btn').length"), {
    label: 'item menu',
  });
  const menuBtns = await evalJS(browser, "document.querySelectorAll('.item-menu__btn').length");
  if (menuBtns !== 3) fails.push(`항목 메뉴 버튼 3 기대, 실제 ${menuBtns}`);
  // '단독 보기' 클릭 → 목록 필터 + 캘린더 닫힘 + 배너
  await evalJS(
    browser,
    "[...document.querySelectorAll('.item-menu__btn')].find(b=>b.textContent.includes('단독'))?.click()",
  );
  await until(() => evalJS(browser, "document.getElementById('group-banner').hidden === false"), {
    label: 'filter banner',
  });
  const p4b = await evalJS(
    browser,
    `(() => ({
       banner: !document.getElementById('group-banner').hidden,
       cards: document.querySelectorAll('#list .card').length,
       calClosed: document.getElementById('calendar-drawer').hidden,
     }))()`,
  );
  if (!p4b.banner) fails.push('단독 보기 배너 없음');
  if (p4b.cards !== 1) fails.push(`단독 보기 카드 1 기대, 실제 ${p4b.cards}`);
  if (!p4b.calClosed) fails.push('단독 보기 후 캘린더 안 닫힘');

  // 10) 세그먼트 컨트롤(드롭다운 대체)로 라이트 테마 전환 — 클릭 1번에 즉시 적용
  await evalJS(browser, "document.getElementById('settings-fab').click()");
  await until(() => evalJS(browser, "!document.getElementById('settings-drawer').hidden"), {
    label: 'settings open',
  });
  const s10 = await evalJS(
    browser,
    `(() => ({
       segCount: document.querySelectorAll('.settings .segmented').length,
       dateToggles: document.querySelectorAll('#set-dates .seg').length,
       footerBtns: document.querySelectorAll('.settings__footer button').length,
       headerClose: !!document.querySelector('#settings-drawer .drawer__close'),
       accents: document.querySelectorAll('#set-accent .swatch').length,
     }))()`,
  );
  await evalJS(browser, `document.querySelector('#set-theme .seg[data-value="light"]')?.click()`);
  await until(() => evalJS(browser, "document.documentElement.dataset.theme === 'light'"), {
    label: 'theme light',
  });
  const theme = await evalJS(browser, 'document.documentElement.dataset.theme');
  const segPressed = await evalJS(
    browser,
    `document.querySelector('#set-theme .seg[data-value="light"]')?.getAttribute('aria-pressed')`,
  );
  if (s10.segCount !== 6) fails.push(`세그먼트 6개(셀렉트5+날짜1) 기대, 실제 ${s10.segCount}`);
  if (s10.dateToggles !== 3) fails.push(`날짜 토글 3개 기대, 실제 ${s10.dateToggles}`);
  if (s10.footerBtns !== 2) fails.push(`푸터 버튼 2개(취소/확인) 기대, 실제 ${s10.footerBtns}`);
  if (s10.headerClose) fails.push('설정 헤더 ✕가 아직 있음(제거 기대)');
  if (s10.accents !== 4) fails.push(`강조색 4개 기대, 실제 ${s10.accents}`);
  if (theme !== 'light') fails.push(`세그먼트로 라이트 전환 실패: ${theme}`);
  if (segPressed !== 'true') fails.push('세그먼트 선택 표시(aria-pressed) 실패');
  const lightShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-light.png'), Buffer.from(lightShot.data, 'base64'));

  console.log('카드 검증:', JSON.stringify(checks, null, 2));
  console.log('캘린더 검증:', JSON.stringify(cal, null, 2));
  console.log('P4 검증:', JSON.stringify({ ...p4a, menuBtns, ...p4b }, null, 2));
  console.log('설정/세그먼트 검증:', JSON.stringify({ theme, segPressed, ...s10 }));
  console.log('스크린샷:', out, '+ verify-calendar.png + verify-light.png');
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
