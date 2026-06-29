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
  // 헤드리스에선 창이 비활성이라 element.focus()가 focus 이벤트를 안 쏨 → 포커스 에뮬레이션 ON.
  try {
    await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  } catch {}
  // 모바일 우선 개발 → 폰 크기 뷰포트로 검증/스크린샷(밀도·레이아웃을 모바일 기준으로 판단).
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
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
      laps: ['2026-06-27T07:33:27.000Z', '2026-06-27T07:33:25.000Z', '2026-06-27T07:33:23.000Z'],
    },
  ]);
  // 설정도 기본값으로 초기화(이전 실행 잔여 제거 → 진행률 파트·날짜형식 등 결정적 검증).
  await evalJS(browser, `localStorage.removeItem('settings'); localStorage.setItem('countdowns', ${JSON.stringify(seed)}); location.reload();`);
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
       timeInRight: !!document.querySelector('.card__col--right .card__time'),
       labelInLeft: !!document.querySelector('.card__col--left .card__label'),
       lapsInRight: !!document.querySelector('.card__col--right .card__laps'),
       lapRelChip: document.querySelector('.card__laps .lap__edit--rel .chip')?.textContent,
       lapTargetChip: document.querySelector('.card__laps .lap__edit--target .chip')?.textContent,
       titleChip: document.querySelector('.card__label .chip')?.textContent,
       // 삭제 ✕가 독립 열로 분리(구분선 border-left 존재)
       lapDelSeparated: (() => { const d = document.querySelector('.card__laps .lap__del');
         return !!d && parseFloat(getComputedStyle(d).borderLeftWidth) > 0; })(),
       // 무채색: 랩 상대시간 색이 메인 시간(방향색)과 달라야 함(= --fg 무채색)
       lapMono: (() => {
         const v = document.querySelector('.card__laps .lap__val');
         const t = document.querySelector('.card__time .card__num');
         return !!v && !!t && getComputedStyle(v).color !== getComputedStyle(t).color;
       })(),
       // zone2·zone3 가로폭 동일(grid 두 트랙 px 차이 1px 미만)
       colsEqual: (() => {
         const cols = document.querySelector('.card__cols');
         if (!cols) return false;
         const tc = getComputedStyle(cols).gridTemplateColumns.split(' ');
         return tc.length === 2 && Math.abs(parseFloat(tc[0]) - parseFloat(tc[1])) < 1;
       })(),
       railLeftHandle: !!document.querySelector('.card__rail--left .card__handle'),
       railLeftHide: !!document.querySelector('.card__rail--left .card__hide'),
       railRightDel: !!document.querySelector('.card__rail--right .card__del'),
       railRightLap: !!document.querySelector('.card__rail--right .card__lap svg'),
       // 기록(랩) 아이콘 색이 삭제(✕)와 동일한 무채색이어야 함(혼자 강조색 X)
       railLapNeutral: (() => { const l = document.querySelector('.card__rail--right .card__lap');
         const x = document.querySelector('.card__rail--right .card__del');
         return !!l && !!x && getComputedStyle(l).color === getComputedStyle(x).color; })(),
       lapEdits: document.querySelectorAll('.card__laps .lap__edit').length,
       bodyHasCols: !!document.querySelector('.card__body > .card__cols'),
       tagAddInGroups: !!document.querySelector('.card__groups .card__groupbtn'),
       tagAddText: document.querySelector('.card__groups .card__groupbtn')?.textContent,
       lapsShown: document.querySelectorAll('.card__laps .lap:not(.lap--more)').length,
       lapMore: !!document.querySelector('.card__laps .lap__more'),
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
  if (!checks.railRightLap) fails.push('기록 버튼(아이콘)이 우측 레일 하단(.card__rail--right .card__lap)에 없음');
  if (!checks.railLapNeutral) fails.push('기록 아이콘이 다른 레일 아이콘(✕)과 다른 색(혼자 강조색) — 무채색 기대');
  if (checks.lapEdits < 2) fails.push(`기록 행에 편집 버튼 2개(기준일시·기록시각) 기대, 실제 ${checks.lapEdits}`);
  if (!checks.timeInRight) fails.push('큰 시간이 우측 열(.card__col--right)에 없음');
  if (!checks.labelInLeft) fails.push('제목이 좌측 열(.card__col--left)에 없음');
  if (!checks.lapsInRight) fails.push('기록(랩) 목록이 우측 열(.card__col--right .card__laps)에 없음');
  if (checks.lapRelChip !== '남은시간' && checks.lapRelChip !== '지난시간')
    fails.push(`기록 상대시간 칩 기대(남은/지난시간), 실제 "${checks.lapRelChip}"`);
  if (checks.lapTargetChip !== '기준일시')
    fails.push(`기록 기준일시 칩 텍스트="${checks.lapTargetChip}" (기준일시 기대)`);
  if (checks.titleChip !== '제목') fails.push(`제목 칩 텍스트="${checks.titleChip}" (제목 기대)`);
  if (!checks.lapDelSeparated) fails.push('기록 삭제(✕)가 독립 열(구분선)로 분리되지 않음');
  if (!checks.lapMono) fails.push('기록 상대시간이 무채색이 아님(메인 시간 방향색과 동일)');
  if (!checks.colsEqual) fails.push('zone2·zone3(.card__cols) 가로폭이 동일하지 않음');
  if (checks.lapsShown !== 1) fails.push(`기록 접힘 시 최근 1개만 기대, 실제 ${checks.lapsShown}`);
  if (!checks.lapMore) fails.push('기록 더보기 토글(.lap__more)이 없음');
  if (!checks.tagAddInGroups) fails.push('＋태그 칩이 태그 줄(.card__groups)에 없음');
  if (checks.tagAddText !== '＋ 태그') fails.push(`＋태그 칩 텍스트="${checks.tagAddText}" (＋ 태그 기대)`);
  // 4열 구조: 좌 레일(핸들/숨기기) · 본문(cols) · 우 레일(✕)
  if (!checks.railLeftHandle) fails.push('드래그 핸들이 좌측 레일(.card__rail--left)에 없음');
  if (!checks.railLeftHide) fails.push('숨기기 버튼(.card__hide)이 좌측 레일에 없음');
  if (!checks.railRightDel) fails.push('삭제(✕)가 우측 레일(.card__rail--right)에 없음');
  if (!checks.bodyHasCols) fails.push('본문(.card__body) 안에 2열(.card__cols)이 없음');

  // 6.5a) 기록(랩) 기준일시 편집 → laps[0].target 갱신(at은 숨은 기준점으로 유지)
  await evalJS(browser, "document.querySelector('.card__laps .lap__edit[data-which=\"target\"]').click()");
  await until(() => evalJS(browser, "!!document.querySelector('.card__editor[data-field=\"lap-target\"]')"), {
    label: 'lap-target editor',
  });
  await evalJS(
    browser,
    `(() => { const i = document.querySelector('.card__editor .card__editinput');
       i.value = '2031-01-02 03:04:05'; i.dispatchEvent(new Event('input', { bubbles: true }));
       document.querySelector('.card__editor .card__save').click(); })()`,
  );
  await until(
    () => evalJS(browser, "/^2031-01-02/.test(JSON.parse(localStorage.getItem('countdowns'))[0].laps[0].target || '')"),
    { label: 'lap target saved' },
  );
  const lapEdited = await evalJS(browser, "JSON.parse(localStorage.getItem('countdowns'))[0].laps[0]");
  if (!(lapEdited && lapEdited.at && /^2031-01-02/.test(lapEdited.target)))
    fails.push(`기록 기준일시 편집 실패: ${JSON.stringify(lapEdited)}`);
  // 기록 시각(at)은 더 이상 표시하지 않아야 함(편집 버튼 'at' 없음)
  if (await evalJS(browser, "!!document.querySelector('.card__laps .lap__edit[data-which=\"at\"]')"))
    fails.push('기록 시각(at) 표시/편집이 아직 남아 있음(제거 대상)');

  // 6.5b) 상대시간 편집 → 기준일시 연동(round-trip): rel을 −02:00:00로 → lap__val이 02:00:00 반영
  await evalJS(browser, "document.querySelector('.card__laps .lap__edit[data-which=\"rel\"]').click()");
  await until(() => evalJS(browser, "!!document.querySelector('.card__editor[data-field=\"lap-rel\"]')"), {
    label: 'lap-rel editor',
  });
  // 형식 해석 보강: 'd'(일) 표기도 인식해야 함(−1d 17:48:15 → 미리보기 ok)
  const dFmtOk = await evalJS(
    browser,
    `(() => { const i = document.querySelector('.card__editor .card__editinput');
       i.value = '-1d 17:48:15'; i.dispatchEvent(new Event('input', { bubbles: true }));
       return document.querySelector('.card__editpreview')?.dataset.ok; })()`,
  );
  if (dFmtOk !== 'yes') fails.push(`상대시간 'd'(일) 형식 해석 실패(미리보기 ok=${dFmtOk})`);
  await evalJS(
    browser,
    `(() => { const i = document.querySelector('.card__editor .card__editinput');
       i.value = '−02:00:00'; i.dispatchEvent(new Event('input', { bubbles: true }));
       document.querySelector('.card__editor .card__save').click(); })()`,
  );
  await until(
    () => evalJS(browser, "(document.querySelector('.card__laps .lap__val')?.textContent || '').includes('02:00:00')"),
    { label: 'lap-rel linked to target' },
  );
  const relRoundtrip = await evalJS(
    browser,
    `(() => { const v = document.querySelector('.card__laps .lap__val')?.textContent || '';
       const l = JSON.parse(localStorage.getItem('countdowns'))[0].laps[0];
       return { val: v, atMs: new Date(l.at).getTime(), tgtMs: new Date(l.target).getTime() }; })()`,
  );
  if (!relRoundtrip.val.includes('02:00:00'))
    fails.push(`상대시간 편집 round-trip 실패, lap__val="${relRoundtrip.val}"`);
  if (Math.abs(relRoundtrip.tgtMs - relRoundtrip.atMs - 2 * 3600 * 1000) > 1500)
    fails.push('상대시간 편집이 기준일시(target = at + 2h)에 연동되지 않음');

  // 6.6) 조합(재생목록식): 카드 ＋조합 → 팝오버 → 새 조합 생성·토글 → 칩 표시 + 영속
  if (!(await evalJS(browser, "!!document.querySelector('.card .card__groupbtn')")))
    fails.push('카드에 ＋조합 버튼 없음');
  await evalJS(browser, "document.querySelector('.card .card__groupbtn')?.click()");
  await until(() => evalJS(browser, "!!document.querySelector('.combo-pop')"), { label: 'combo popover' });
  await evalJS(
    browser,
    `(() => { const i = document.querySelector('.combo-pop .combo__newname');
       i.value = '시험공부'; i.dispatchEvent(new Event('input', { bubbles: true }));
       document.querySelector('.combo-pop .combo__add')?.click(); })()`,
  );
  await until(
    () => evalJS(browser, "(JSON.parse(localStorage.getItem('groups')||'[]')[0]?.itemIds||[]).includes('verify-1')"),
    { label: 'combo membership saved' },
  );
  const combo = await evalJS(
    browser,
    `(() => ({
       groups: JSON.parse(localStorage.getItem('groups')||'[]').length,
       memberOf: (JSON.parse(localStorage.getItem('groups')||'[]')[0]?.itemIds||[]).includes('verify-1'),
       chipText: document.querySelector('.card .card__group')?.textContent,
       pressed: document.querySelector('.combo-pop .combo__opt')?.getAttribute('aria-pressed'),
       popExists: !!document.querySelector('.combo-pop'),
       optCount: document.querySelectorAll('.combo-pop .combo__opt').length,
     }))()`,
  );
  if (combo.groups !== 1) fails.push(`조합 1개 기대, 실제 ${combo.groups}`);
  if (!combo.memberOf) fails.push('새 조합에 카드가 안 들어감');
  if (combo.chipText !== '시험공부') fails.push(`카드 조합 칩="${combo.chipText}" (시험공부 기대)`);
  if (combo.pressed !== 'true') fails.push('조합 토글 aria-pressed=true 아님');
  if (!combo.popExists) fails.push('토글 후 팝오버가 닫힘(내부 클릭 전파 차단 회귀)');
  const comboShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-combo.png'), Buffer.from(comboShot.data, 'base64'));
  await evalJS(browser, "document.body.click()"); // 팝오버 닫기(다음 단계 간섭 방지)

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
  // 에디터에 '무엇을 수정하는지' 라벨 + 원본 필드 강조(data-editing) 확인
  const ed = await evalJS(
    browser,
    `(() => ({
       label: document.querySelector('.card__editor .card__editlabel')?.textContent,
       editing: document.querySelector('.card[data-editing]')?.dataset.editing,
     }))()`,
  );
  if (!/진행 시작점/.test(ed.label || '')) fails.push(`에디터 라벨="${ed.label}" (진행 시작점 기대)`);
  if (ed.editing !== 'start') fails.push(`수정중 필드 강조 data-editing="${ed.editing}" (start 기대)`);
  // 인라인 에디터(컴팩트 밀도 + 라벨/강조) 스크린샷
  const edShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-editor.png'), Buffer.from(edShot.data, 'base64'));
  await evalJS(browser, "document.querySelector('.card__editor .card__save')?.click()");
  await until(
    () => evalJS(browser, "(JSON.parse(localStorage.getItem('countdowns'))[0].startISO || '').length > 0"),
    { label: 'startISO saved' },
  );
  const startISO = await evalJS(browser, "JSON.parse(localStorage.getItem('countdowns'))[0].startISO");
  if (!startISO) fails.push('커스텀 진행 시작(startISO) 저장 실패');

  // 7.6) 진행 시작점 3방식: '50%'(지금이 50%) · '5시간'(기준일시−기간) 입력 검증
  const setStart = async (val) => {
    await evalJS(browser, "document.querySelector('.card__progress')?.click()");
    await until(() => evalJS(browser, `!!document.querySelector('.card__editor[data-field="start"]')`), { label: 'start editor ' + val });
    await evalJS(
      browser,
      `(() => { const i = document.querySelector('.card__editor .card__editinput');
         i.value = ${JSON.stringify(val)}; i.dispatchEvent(new Event('input', { bubbles: true }));
         document.querySelector('.card__editor .card__save').click(); })()`,
    );
  };
  // % 입력: 지금이 진행률 ~50%가 되도록 startISO 역산
  await setStart('50%');
  await until(() => evalJS(browser, "!document.querySelector('.card__editor[data-field=\"start\"]')"), { label: 'pct start saved' });
  const fAfterPct = await evalJS(
    browser,
    `(() => { const r = JSON.parse(localStorage.getItem('countdowns'))[0];
       const s = new Date(r.startISO).getTime(), t = new Date(r.targetISO).getTime(), n = Date.now();
       return (n - s) / (t - s); })()`,
  );
  if (!(fAfterPct > 0.48 && fAfterPct < 0.52)) fails.push(`'50%' 시작 역산 실패, 현재 진행률=${fAfterPct}`);
  // duration 입력: startISO = 기준일시 − 5시간
  await setStart('5시간');
  await until(() => evalJS(browser, "!document.querySelector('.card__editor[data-field=\"start\"]')"), { label: 'dur start saved' });
  const gapH = await evalJS(
    browser,
    `(() => { const r = JSON.parse(localStorage.getItem('countdowns'))[0];
       return (new Date(r.targetISO).getTime() - new Date(r.startISO).getTime()) / 3600000; })()`,
  );
  if (Math.abs(gapH - 5) > 0.05) fails.push(`'5시간' 기간 시작 계산 실패, 기준일시−시작=${gapH}h`);

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
       basisSegs: document.querySelectorAll('#cal-basis .seg').length,
       weekSegs: document.querySelectorAll('#cal-weekstart .seg').length,
       firstWd: document.querySelector('#cal-grid .cal__wd')?.textContent,
       calItems: document.querySelectorAll('#cal-grid .cal__item').length,
     }))()`,
  );
  if (p4a.basisSegs !== 3) fails.push(`기준 세그먼트 3 기대, 실제 ${p4a.basisSegs}`);
  if (p4a.weekSegs !== 2) fails.push(`시작요일 세그먼트 2 기대, 실제 ${p4a.weekSegs}`);
  if (p4a.firstWd !== '월') fails.push(`기본 시작요일 월(첫 헤더) 기대, 실제 ${p4a.firstWd}`);
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
  if (s10.segCount !== 5) fails.push(`세그먼트 5개(셀렉트4+날짜1) 기대, 실제 ${s10.segCount}`);
  if (s10.dateToggles !== 3) fails.push(`날짜 토글 3개 기대, 실제 ${s10.dateToggles}`);
  if (s10.footerBtns !== 2) fails.push(`푸터 버튼 2개(취소/확인) 기대, 실제 ${s10.footerBtns}`);
  if (s10.headerClose) fails.push('설정 헤더 ✕가 아직 있음(제거 기대)');
  if (s10.accents !== 0) fails.push(`강조색 제거 기대, 실제 ${s10.accents}`);
  if (theme !== 'light') fails.push(`세그먼트로 라이트 전환 실패: ${theme}`);
  if (segPressed !== 'true') fails.push('세그먼트 선택 표시(aria-pressed) 실패');

  // 10.4) 진행률 파트(바·파이·퍼센트): 기본 전부 표시 + 파트 칩 3개 + 퍼센트 토글 끄기 동작
  const pp0 = await evalJS(
    browser,
    `(() => ({
       chips: [...document.querySelectorAll('#set-progress-parts .ppart')].map((b) => b.dataset.part),
       pressed: [...document.querySelectorAll('#set-progress-parts .ppart')].map((b) => b.getAttribute('aria-pressed')),
       barShown: !document.querySelector('.card__bar')?.hidden,
       pieShown: !document.querySelector('.card__pie')?.hidden,
       pctShown: !document.querySelector('.card__pct')?.hidden,
       pctText: document.querySelector('.card__pct')?.textContent,
     }))()`,
  );
  if (pp0.chips.join() !== 'bar,pie,percent')
    fails.push(`진행률 파트 칩 기대 [bar,pie,percent], 실제 [${pp0.chips}]`);
  if (pp0.pressed.some((p) => p !== 'true')) fails.push('진행률 파트 기본 전부 켜짐(aria-pressed) 아님');
  if (!(pp0.barShown && pp0.pieShown && pp0.pctShown))
    fails.push(`진행률 기본 전부 표시 아님(bar=${pp0.barShown} pie=${pp0.pieShown} pct=${pp0.pctShown})`);
  if (!/^\d+%$/.test(pp0.pctText || '')) fails.push(`퍼센트 텍스트 형식 실패: "${pp0.pctText}"`);
  // 퍼센트 칩 탭(클릭=pointerdown+up, 이동 없음 → 토글) → 카드 퍼센트 숨김
  await evalJS(
    browser,
    `(() => { const c = document.querySelector('#set-progress-parts .ppart[data-part="percent"]');
       const r = c.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
       const o = { bubbles: true, clientX: x, clientY: y, pointerId: 1 };
       c.dispatchEvent(new PointerEvent('pointerdown', o));
       c.dispatchEvent(new PointerEvent('pointerup', o)); })()`,
  );
  await until(() => evalJS(browser, "document.querySelector('.card__pct')?.hidden === true"), { label: 'pct toggled off' });
  const pctOff = await evalJS(
    browser,
    "document.querySelector('#set-progress-parts .ppart[data-part=\"percent\"]')?.getAttribute('aria-pressed')",
  );
  if (pctOff !== 'false') fails.push(`퍼센트 칩 끄기 후 aria-pressed=false 기대, 실제 ${pctOff}`);
  // 다시 켜서 원복
  await evalJS(
    browser,
    `(() => { const c = document.querySelector('#set-progress-parts .ppart[data-part="percent"]');
       const r = c.getBoundingClientRect(); const o = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 };
       c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)); })()`,
  );
  // 드래그로 순서 변경: '바'를 맨 뒤로 끌기 → progressOrder = [pie,percent,bar]
  await evalJS(
    browser,
    `(() => { const parts = document.querySelectorAll('#set-progress-parts .ppart');
       const bar = parts[0], last = parts[parts.length - 1];
       const br = bar.getBoundingClientRect(), lr = last.getBoundingClientRect(); const cy = br.top + br.height / 2;
       const fire = (t, x) => bar.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: cy, pointerId: 2 }));
       fire('pointerdown', br.left + br.width / 2);
       fire('pointermove', lr.left + lr.width * 0.75);
       fire('pointerup', lr.left + lr.width * 0.75); })()`,
  );
  await until(
    () => evalJS(browser, "JSON.parse(localStorage.getItem('settings')||'{}').progressOrder?.join(',') === 'pie,percent,bar'"),
    { label: 'progress reordered by drag' },
  );
  const reordered = await evalJS(browser, "JSON.parse(localStorage.getItem('settings')).progressOrder.join(',')");
  if (reordered !== 'pie,percent,bar') fails.push(`드래그 순서 변경 실패, order=${reordered}`);

  // 10.5) 날짜 표시 형식: 컴팩트(기본 260628일…) ↔ 전체(2026-06-28 …) 토글 → 카드 기준일시 텍스트 변화
  const metaDefault = await evalJS(browser, "document.querySelector('.card__metadate')?.textContent");
  if (!/^\d{6}[일월화수목금토]/.test(metaDefault || '')) fails.push(`기본 컴팩트 날짜 형식 아님: "${metaDefault}"`);
  await evalJS(browser, "document.querySelector('#set-date-format .seg[data-value=\"full\"]').click()");
  await until(() => evalJS(browser, "/\\d{4}-\\d{2}-\\d{2}/.test(document.querySelector('.card__metadate')?.textContent||'')"), { label: 'date full' });
  const metaFull = await evalJS(browser, "document.querySelector('.card__metadate')?.textContent");
  if (!/^\d{4}-\d{2}-\d{2} /.test(metaFull || '')) fails.push(`전체 날짜 형식 아님: "${metaFull}"`);
  await evalJS(browser, "document.querySelector('#set-date-format .seg[data-value=\"compact\"]').click()");
  await until(() => evalJS(browser, "/^\\d{6}/.test(document.querySelector('.card__metadate')?.textContent||'')"), { label: 'date compact' });

  const lightShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-light.png'), Buffer.from(lightShot.data, 'base64'));

  // 10.5) 태그 이름 변경: (설정 드로어 닫고) 태그 드로어 → 이름 클릭 → 입력 → Enter → 반영
  await evalJS(browser, "document.querySelector('#settings-drawer .drawer__backdrop')?.click()");
  await until(() => evalJS(browser, "document.getElementById('settings-drawer').hidden"), { label: 'settings closed' });
  await evalJS(browser, "document.getElementById('groups-fab').click()");
  await until(() => evalJS(browser, "!!document.querySelector('#groups-list .group__name')"), {
    label: 'tag list',
  });
  const tagsShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-tags.png'), Buffer.from(tagsShot.data, 'base64'));
  await evalJS(browser, "document.querySelector('#groups-list .group__name').click()");
  await until(() => evalJS(browser, "!!document.querySelector('#groups-list .group__rename')"), {
    label: 'tag rename input',
  });
  await evalJS(
    browser,
    `(() => { const i = document.querySelector('#groups-list .group__rename');
       i.value = '시험공부2'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`,
  );
  await until(
    () => evalJS(browser, "JSON.parse(localStorage.getItem('groups')||'[]')[0]?.name === '시험공부2'"),
    { label: 'tag renamed' },
  );
  const renamed = await evalJS(browser, "JSON.parse(localStorage.getItem('groups')||'[]')[0]?.name");
  if (renamed !== '시험공부2') fails.push(`태그 이름변경 실패: ${renamed}`);
  await evalJS(browser, "document.getElementById('groups-drawer').querySelector('[data-close]')?.click()");

  // 11) 밀도 데모: 모바일 폭에서 여러 카드 스택 스크린샷(우측 액션 레일·압축 레이아웃 판단용)
  const many = JSON.stringify(
    Array.from({ length: 4 }, (_, i) => {
      const dir = i % 2 === 0 ? 1 : -1; // 미래/과거 섞기
      const dt = new Date(Date.now() + dir * (i + 1) * 5 * 3600 * 1000);
      const pp = (n) => String(n).padStart(2, '0');
      const iso = `${dt.getFullYear()}-${pp(dt.getMonth() + 1)}-${pp(dt.getDate())}T${pp(dt.getHours())}:${pp(dt.getMinutes())}:00`;
      return { id: 'g' + i, label: '타임카드 ' + (i + 1), targetISO: iso, createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-25T00:00:00.000Z' };
    }),
  );
  await evalJS(browser, `localStorage.setItem('countdowns', ${JSON.stringify(many)}); location.reload();`);
  await until(() => evalJS(browser, 'document.querySelectorAll(".card").length >= 4'), { label: 'list cards' });
  const listShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-list.png'), Buffer.from(listShot.data, 'base64'));

  // 12) 빈 상태: 카드 0개 → 안내 문구 표시
  await evalJS(browser, "localStorage.setItem('countdowns', '[]'); location.reload();");
  await until(() => evalJS(browser, "document.readyState === 'complete' && document.querySelectorAll('.card').length === 0"), {
    label: 'empty reload',
  });
  const empty = await evalJS(
    browser,
    `(() => ({ hidden: document.getElementById('empty-hint').hidden, text: document.getElementById('empty-hint').textContent.trim() }))()`,
  );
  if (empty.hidden) fails.push('빈 상태 안내가 숨겨져 있음');
  if (!/아직 타임카드가 없습니다/.test(empty.text)) fails.push(`빈 상태 문구="${empty.text}"`);

  // 13) 추가 흐름(form submit + 지금 버튼): 빈 상태 → ＋FAB → 지금/입력 → form submit → 카드 1개
  await evalJS(browser, "document.getElementById('fab').click()");
  await until(() => evalJS(browser, "!document.getElementById('drawer').hidden"), { label: 'add drawer open' });
  await evalJS(browser, "document.getElementById('now-btn').click()");
  const nowFilled = await evalJS(browser, "document.getElementById('text-input').value.trim().length > 0");
  if (!nowFilled) fails.push("'지금' 버튼이 기준일시를 채우지 못함");
  // '오늘' 버튼: 오늘 날짜를 YYMMDD(6자리)로 채움
  await evalJS(browser, "document.getElementById('today-btn').click()");
  const todayVal = await evalJS(browser, "document.getElementById('text-input').value.trim()");
  if (!/^\d{6}$/.test(todayVal)) fails.push(`'오늘' 버튼 YYMMDD 채움 실패: "${todayVal}"`);
  const addShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-add.png'), Buffer.from(addShot.data, 'base64'));
  // 다음 칸으로 이동(=제목 focus) 시 빈 기준일시 현재시각 자동채움(탭/엔터/모바일'다음' 동등)
  await evalJS(
    browser,
    `(() => { const i = document.getElementById('text-input');
       i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true }));
       document.getElementById('label-input').focus(); })()`,
  );
  const advanceFilled = await evalJS(browser, "document.getElementById('text-input').value.trim().length > 0");
  if (!advanceFilled) fails.push('제목으로 이동 시 빈 기준일시 자동채움 실패');
  await evalJS(
    browser,
    `(() => { const i = document.getElementById('text-input');
       i.value = '2026-12-31 23:59:00'; i.dispatchEvent(new Event('input', { bubbles: true }));
       document.getElementById('add-form').requestSubmit(); })()`,
  );
  await until(() => evalJS(browser, "document.querySelectorAll('.card').length === 1"), {
    label: 'card added via form submit',
  });
  const addedCount = await evalJS(browser, "document.querySelectorAll('.card').length");
  if (addedCount !== 1) fails.push(`form submit 추가 실패, 카드 ${addedCount}`);

  // 14) 클릭형 달력 선택기: ＋FAB → (선택기 항상 표시) → 날짜 클릭 → 추가 → 카드 2개
  await evalJS(browser, "document.getElementById('fab').click()");
  await until(() => evalJS(browser, "!document.getElementById('drawer').hidden"), { label: 'add drawer 2' });
  // 3영역 재구성: 태그 지정 제거 + 선택기는 접힘 없이 바로 보임(openAddDrawer가 초기화)
  const addPanel = await evalJS(
    browser,
    `(() => ({
       noTagChooser: !document.getElementById('add-groups'),
       noPickerDetails: !document.getElementById('add-picker'),
       zones: document.querySelectorAll('.add .addzone').length,
       fmtHidden: document.getElementById('add-formats').hidden,
     }))()`,
  );
  if (!addPanel.noTagChooser) fails.push('태그 지정(add-groups)이 아직 추가 패널에 있음');
  if (!addPanel.noPickerDetails) fails.push('선택기가 아직 details(add-picker)로 접혀 있음');
  if (addPanel.zones !== 3) fails.push(`추가 패널 3영역 기대, 실제 ${addPanel.zones}`);
  if (!addPanel.fmtHidden) fails.push('지원 형식 패널이 평소 숨김이 아님');
  // 지원 형식 버튼: 인라인 아래 펼침이 아니라 팝오버(body로 옮겨 position:fixed)로 표시
  await evalJS(browser, "document.getElementById('fmt-btn').click()");
  const fmtPop = await evalJS(
    browser,
    `(() => { const f = document.getElementById('add-formats');
       return { shown: !f.hidden, inBody: f.parentElement === document.body,
                fixed: getComputedStyle(f).position === 'fixed' }; })()`,
  );
  if (!fmtPop.shown) fails.push('지원 형식 버튼이 팝오버를 열지 못함');
  if (!fmtPop.inBody) fails.push('지원 형식 팝오버가 body로 이동하지 않음(드로어 transform 영향 위험)');
  if (!fmtPop.fixed) fails.push('지원 형식 팝오버가 fixed 배치가 아님');
  // 바깥 클릭으로 닫힘
  await evalJS(browser, "document.body.click()");
  if (await evalJS(browser, "!document.getElementById('add-formats').hidden"))
    fails.push('지원 형식 팝오버가 바깥 클릭으로 닫히지 않음');
  await until(() => evalJS(browser, "document.querySelectorAll('#pick-days .pick__day').length >= 28"), {
    label: 'picker (year+month chips, day grid)',
  });
  const pickInfo = await evalJS(
    browser,
    `(() => ({
       years: document.querySelectorAll('#pick-years .pick__opt').length,
       months: document.querySelectorAll('#pick-months .pick__opt').length,
       days: document.querySelectorAll('#pick-days .pick__day').length,
       wd: document.querySelectorAll('#pick-days .cal__wd').length,
       selY: !!document.querySelector('#pick-years .pick__opt--sel'),
       selM: !!document.querySelector('#pick-months .pick__opt--sel'),
       selD: !!document.querySelector('#pick-days .pick__day--sel'),
     }))()`,
  );
  if (pickInfo.years !== 10) fails.push(`연도 칩 10개(십년뷰) 기대, 실제 ${pickInfo.years}`);
  if (pickInfo.months !== 12) fails.push(`월 칩 12개 기대, 실제 ${pickInfo.months}`);
  if (pickInfo.wd !== 7) fails.push(`일 달력 요일헤더 7 기대, 실제 ${pickInfo.wd}`);
  if (pickInfo.days !== 42) fails.push(`일 달력 6주 고정(42칸) 기대, 실제 ${pickInfo.days}`);
  if (!pickInfo.selY || !pickInfo.selM || !pickInfo.selD) fails.push('연/월/일 기본 선택 표시 누락');
  // 시간 텍스트 해석(1430 → 14:30)
  await evalJS(
    browser,
    "(() => { const t = document.getElementById('pick-time'); t.value = '1430'; t.dispatchEvent(new Event('input', { bubbles: true })); })()",
  );
  const timeOk = await evalJS(browser, "document.getElementById('pick-sel').dataset.ok");
  if (timeOk !== 'yes') fails.push(`시간 텍스트 해석 실패, ok=${timeOk}`);
  // 연도 텍스트 입력으로 먼 연도 점프(2020~2044 밖)
  await evalJS(
    browser,
    "(() => { const y = document.getElementById('pick-yinput'); y.value = '2099'; y.dispatchEvent(new Event('change', { bubbles: true })); })()",
  );
  const yJump = await evalJS(browser, "document.getElementById('pick-mlabel').textContent");
  if (!/2099/.test(yJump)) fails.push(`연도 텍스트 입력 점프 실패, 라벨=${yJump}`);
  // 연도 십년뷰 prev → 칩 범위 이동
  const firstYrBefore = await evalJS(browser, "document.querySelector('#pick-years .pick__opt').textContent");
  await evalJS(browser, "document.getElementById('pick-yprev').click()");
  const firstYrAfter = await evalJS(browser, "document.querySelector('#pick-years .pick__opt').textContent");
  if (firstYrBefore === firstYrAfter) fails.push('연도 prev(10년) 이동이 칩 범위를 안 바꿈');
  // 연도 칩 클릭으로 선택(현재 십년뷰 첫 칩)
  await evalJS(browser, "document.querySelector('#pick-years .pick__opt').click()");
  // 일 헤더 월 네비 존재 + 다음 달 버튼 동작
  const navOk = await evalJS(
    browser,
    "['pick-yprev','pick-prev','pick-next','pick-ynext','pick-yinput','pick-dyprev','pick-dynext'].every((id) => !!document.getElementById(id))",
  );
  if (!navOk) fails.push('연도 입력/네비·월/해 네비(«‹›») 요소 누락');
  const mlBefore = await evalJS(browser, "document.getElementById('pick-mlabel').textContent");
  await evalJS(browser, "document.getElementById('pick-next').click()");
  const mlAfter = await evalJS(browser, "document.getElementById('pick-mlabel').textContent");
  if (mlBefore === mlAfter) fails.push('다음 달 버튼(›)이 월 라벨을 바꾸지 못함');
  // 일 헤더 다음 해(») → 라벨 연도 변경
  const mlY1 = await evalJS(browser, "document.getElementById('pick-mlabel').textContent");
  await evalJS(browser, "document.getElementById('pick-dynext').click()");
  const mlY2 = await evalJS(browser, "document.getElementById('pick-mlabel').textContent");
  if (mlY1 === mlY2) fails.push('다음 해 버튼(»)이 라벨 연도를 바꾸지 못함');
  await evalJS(browser, "(() => { const p = document.querySelector('#drawer .drawer__panel'); if (p) p.scrollTop = p.scrollHeight; })()");
  const pickerShot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(ARTIFACTS, 'verify-picker.png'), Buffer.from(pickerShot.data, 'base64'));
  await evalJS(browser, "document.querySelector('#pick-days .pick__day:not(.pick__day--out):not(.pick__day--sel)').click()");
  await evalJS(browser, "document.querySelector('.zone__apply[data-source=\"picker\"]').click()");
  await until(() => evalJS(browser, "document.querySelectorAll('.card').length === 2"), {
    label: 'picker add',
  });
  const pickAdded = await evalJS(browser, "document.querySelectorAll('.card').length");
  if (pickAdded !== 2) fails.push(`달력 선택기 추가 실패, 카드 ${pickAdded}`);

  // 15) 현재 화면에서 숨기기: 숨기기 → 목록서 사라짐 + 숨김바 표시 → 보기 토글 → 다시 표시
  await evalJS(browser, "document.querySelector('#drawer .drawer__backdrop')?.click()"); // 드로어 닫기
  await until(() => evalJS(browser, "document.getElementById('drawer').hidden"), { label: 'drawer closed' });
  if (!(await evalJS(browser, "document.getElementById('hidden-bar').hidden")))
    fails.push('숨긴 카드 없는데 숨김 바가 보임');
  await evalJS(browser, "document.querySelector('.card .card__hide').click()"); // 첫 카드 숨기기
  await until(() => evalJS(browser, "document.querySelectorAll('.card').length === 1"), { label: 'card hidden' });
  const afterHide = await evalJS(
    browser,
    `(() => ({
       cards: document.querySelectorAll('.card').length,
       barShown: !document.getElementById('hidden-bar').hidden,
       toggleText: document.getElementById('hidden-bar-toggle').textContent,
     }))()`,
  );
  if (afterHide.cards !== 1) fails.push(`숨기기 후 카드 1개 기대, 실제 ${afterHide.cards}`);
  if (!afterHide.barShown) fails.push('숨기기 후 숨김 바가 표시되지 않음');
  if (afterHide.toggleText !== '보기') fails.push(`숨김 바 토글="${afterHide.toggleText}" (보기 기대)`);
  await evalJS(browser, "document.getElementById('hidden-bar-toggle').click()"); // 보기 토글
  await until(() => evalJS(browser, "document.querySelectorAll('.card').length === 2"), { label: 'show hidden' });
  const afterShow = await evalJS(
    browser,
    `(() => ({
       cards: document.querySelectorAll('.card').length,
       dimmed: !!document.querySelector('.card--hidden'),
       toggleText: document.getElementById('hidden-bar-toggle').textContent,
     }))()`,
  );
  if (afterShow.cards !== 2) fails.push(`숨김 보기 시 카드 2개 기대, 실제 ${afterShow.cards}`);
  if (!afterShow.dimmed) fails.push('숨김 보기에서 숨긴 카드(.card--hidden)가 흐려지지 않음');
  if (afterShow.toggleText !== '숨기기') fails.push(`숨김 보기 토글="${afterShow.toggleText}" (숨기기 기대)`);
  await evalJS(browser, "document.querySelector('.card--hidden .card__hide').click()"); // 다시 표시(언하이드)
  await until(() => evalJS(browser, "document.getElementById('hidden-bar').hidden"), { label: 'unhidden' });
  if (await evalJS(browser, "!!document.querySelector('.card--hidden')"))
    fails.push('언하이드 후에도 숨김 카드가 남음');

  console.log('카드 검증:', JSON.stringify(checks, null, 2));
  console.log('조합 검증:', JSON.stringify(combo));
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
