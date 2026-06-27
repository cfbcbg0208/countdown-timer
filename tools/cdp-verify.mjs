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
       lapText: document.querySelector('.card__lap')?.textContent,
       timeInRight: !!document.querySelector('.card__col--right .card__time'),
       labelInLeft: !!document.querySelector('.card__col--left .card__label'),
       lapsInRight: !!document.querySelector('.card__col--right .card__laps'),
       actionsHasLap: !!document.querySelector('.card__actions .card__lap'),
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
  if (checks.lapText !== '기록' || /📍/.test(checks.lapText)) fails.push(`기록 버튼 텍스트="${checks.lapText}" (빨간핀 제거·'기록' 기대)`);
  if (!checks.timeInRight) fails.push('큰 시간이 우측 열(.card__col--right)에 없음');
  if (!checks.labelInLeft) fails.push('제목이 좌측 열(.card__col--left)에 없음');
  if (!checks.lapsInRight) fails.push('기록(랩)이 우측 열에 없음');
  if (!checks.actionsHasLap) fails.push('기록 버튼이 액션(.card__actions)에 없음');
  if (checks.lapsShown !== 1) fails.push(`기록 접힘 시 최근 1개만 기대, 실제 ${checks.lapsShown}`);
  if (!checks.lapMore) fails.push('기록 더보기 토글(.lap__more)이 없음');
  if (!checks.tagAddInGroups) fails.push('＋태그 칩이 태그 줄(.card__groups)에 없음');
  if (checks.tagAddText !== '＋ 태그') fails.push(`＋태그 칩 텍스트="${checks.tagAddText}" (＋ 태그 기대)`);

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
  if (ed.label !== '진행 시작 일시') fails.push(`에디터 라벨="${ed.label}" (진행 시작 일시 기대)`);
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
  // 지원 형식 버튼: 펼침/접음 토글
  await evalJS(browser, "document.getElementById('fmt-btn').click()");
  const fmtShown = await evalJS(browser, "!document.getElementById('add-formats').hidden");
  if (!fmtShown) fails.push('지원 형식 버튼이 패널을 펼치지 못함');
  await evalJS(browser, "document.getElementById('fmt-btn').click()");
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
