// 여러 카운트다운을 목록으로 관리(추가·삭제·영속·드래그 수동정렬·동시 틱).
// 렌더 전략: 데이터 변경 시에만 DOM을 (재)구성하고, 매초엔 각 카드의 시간/색만 갱신한다.
// 추가 영역은 우하단 FAB로 열리는 드로어(오버레이)에 들어 있다.
import {
  parseFlexible,
  parseDuration,
  diff,
  formatDuration,
  parseRelative,
  formatLocal,
  formatCompact,
  elapsedFraction,
  startForFraction,
  monthGrid,
  dateKeyOf,
} from './time.js';
import {
  load,
  add,
  remove,
  reorder,
  updateItem,
  setHidden,
  moveId,
  loadGroups,
  addGroup,
  removeGroup,
  renameGroup,
  removeItemFromGroups,
  groupsForItem,
  toggleItemInGroup,
} from './store.js';
import {
  load as loadSettings,
  update as updateSettings,
  reset as resetSettings,
} from './settings.js';

const $ = (id) => document.getElementById(id);
const labelInput = $('label-input');
const textInput = $('text-input');
const textPreview = $('text-preview');
const addForm = $('add-form');
const nowBtn = $('now-btn');
const todayBtn = $('today-btn');
const fmtBtn = $('fmt-btn');
const addFormatsEl = $('add-formats');
const pickYearsEl = $('pick-years');
const pickMonthsEl = $('pick-months');
const pickDaysEl = $('pick-days');
const pickMlabelEl = $('pick-mlabel');
const pickPrevBtn = $('pick-prev');
const pickNextBtn = $('pick-next');
const pickYPrevBtn = $('pick-yprev');
const pickYNextBtn = $('pick-ynext');
const pickDYPrevBtn = $('pick-dyprev');
const pickDYNextBtn = $('pick-dynext');
const pickYInput = $('pick-yinput');
const pickTime = $('pick-time');
const pickSelEl = $('pick-sel');
const listEl = $('list');
const emptyHint = $('empty-hint');
const srStatus = $('sr-status');
const fab = $('fab');
const drawer = $('drawer');
const settingsFab = $('settings-fab');
const settingsDrawer = $('settings-drawer');
const groupsFab = $('groups-fab');
const groupsDrawer = $('groups-drawer');
const calendarFab = $('calendar-fab');
const calendarDrawer = $('calendar-drawer');
const calMonthEl = $('cal-month');
const calGridEl = $('cal-grid');
const calPrevBtn = $('cal-prev');
const calNextBtn = $('cal-next');
const calBasisSel = $('cal-basis');
const calWeekstartSel = $('cal-weekstart');
const groupsNewBtn = $('groups-new');
const groupsListEl = $('groups-list');
const groupsEmpty = $('groups-empty');
const groupBanner = $('group-banner');
const groupBannerName = $('group-banner-name');
const groupBannerClear = $('group-banner-clear');
const selectBar = $('select-bar');
const selectCountEl = $('select-count');
const groupNameInput = $('group-name');
const selectSaveBtn = $('select-save');
const selectCancelBtn = $('select-cancel');
const hiddenBar = $('hidden-bar');
const hiddenBarName = $('hidden-bar-name');
const hiddenBarToggle = $('hidden-bar-toggle');

// 보기 필터: null=전체 | {kind:'group',id} | {kind:'date',key,basis} | {kind:'item',id}.
// (조합 보기·캘린더 날짜 보기·항목 단독 보기를 하나의 필터로 통합)
let viewFilter = null;
// '현재 화면에서 숨기기'한 카드를 임시로 함께 볼지 여부(세션 상태, 기본 숨김).
let showHidden = false;
let selectMode = false;
const selectedIds = new Set();
const BASIS_LABEL = { target: '기준일시', created: '등록일시', updated: '수정일시' };

// 부호는 D-Day 관례: 남은=− (D-7), 지난=+ (D+3). 색은 부호와 별개(남은=초록/지난=빨강).
const DIRS = {
  future: { label: '남은 시간', chip: '남은시간', sign: '−', cls: 'display--future' },
  past: { label: '지난 시간', chip: '지난시간', sign: '+', cls: 'display--past' },
  now: { label: '바로 지금!', chip: '지금', sign: '', cls: '' },
};

// 로컬 시각을 보존하는 ISO 문자열(오프셋 없이 → new Date()가 로컬로 되읽음).
function toLocalISO(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

// 현재 시각을 컴팩트 표기("YYMMDD요일HHMMSS", 예 260626금195225)로. parseFlexible가 되읽을 수 있음.
function compactNow(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const w = '일월화수목금토'[now.getDay()];
  return (
    `${String(now.getFullYear()).slice(-2)}${p(now.getMonth() + 1)}${p(now.getDate())}${w}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

let list = load(localStorage);
let refsList = []; // 화면에 그려진 카드들의 참조 { card, timeEl, metaEl, item, dir }

// 카드 날짜 표시 형식: 설정에 따라 컴팩트(260628일210436) 또는 전체(2026-06-28 일 …).
function fmtDate(date) {
  return settings.dateFormat === 'full' ? formatLocal(date) : formatCompact(date);
}

// 작은 칩(라벨 pill) 생성.
function chip(text, cls = '') {
  const s = document.createElement('span');
  s.className = 'chip' + (cls ? ' ' + cls : '');
  s.textContent = text;
  return s;
}

// 등록/수정 일시 행(설정으로 표시·숨김). 값 + [라벨] 칩. 비편집.
function dateRow(label, iso, show) {
  const row = document.createElement('div');
  row.className = 'card__row card__row--date';
  row.hidden = !show || !iso;
  if (iso) {
    const val = document.createElement('span');
    val.className = 'card__datemeta';
    val.textContent = fmtDate(new Date(iso));
    row.append(val, chip(label));
  }
  return row;
}

// 숨기기/보이기 아이콘(filled mono SVG). hidden=true면 '눈'(보이기), false면 '눈-사선'(숨기기).
function hideIcon(hidden) {
  const eye =
    '<path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5Zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/>';
  const eyeOff =
    '<path d="M12 7c2.8 0 5 2.2 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92A12 12 0 0 0 23 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7ZM2 4.27l2.28 2.28.46.46A11.8 11.8 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27Zm5.53 5.53 1.55 1.55c-.05.21-.08.43-.08.65a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53a5 5 0 0 1-5-5c0-.79.2-1.53.53-2.2Zm4.31-.78 3.15 3.15.02-.16a3 3 0 0 0-3-3l-.17.01Z"/>';
  return `<svg class="card__railicon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${hidden ? eye : eyeOff}</svg>`;
}

// 카드 1장 DOM 생성(텍스트는 textContent로 넣어 자동 이스케이프).
function makeCard(item) {
  const card = document.createElement('article');
  card.className = 'card' + (item.hidden ? ' card--hidden' : '');
  card.dataset.id = item.id;

  // 좌측 레일(상): 드래그 핸들(≡). 드래그·↑/↓ 키로 순서 변경.
  const handle = document.createElement('button');
  handle.className = 'card__handle';
  handle.type = 'button';
  handle.title = '드래그 또는 ↑/↓ 키로 순서 변경';
  handle.setAttribute(
    'aria-label',
    `${item.label || '타임카드'} 순서 변경. 드래그하거나 화살표 위/아래, Home/End 키 사용`,
  );
  handle.innerHTML = '<svg class="card__railicon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6h18v2H3V6Zm0 5h18v2H3v-2Zm0 5h18v2H3v-2Z"/></svg>';

  // 좌측 레일(하): 숨기기/보이기. item.hidden이면 '보이기'(눈), 아니면 '숨기기'(눈-사선).
  const hideBtn = document.createElement('button');
  hideBtn.className = 'card__hide';
  hideBtn.type = 'button';
  hideBtn.dataset.id = item.id;
  hideBtn.title = item.hidden ? '다시 표시' : '현재 화면에서 숨기기';
  hideBtn.setAttribute('aria-label', `${item.label || '타임카드'} ${item.hidden ? '다시 표시' : '숨기기'}`);
  hideBtn.innerHTML = hideIcon(item.hidden);

  // 우측 레일(상): 삭제(✕). (레일 하단은 추후 기능 확장용 빈 슬롯)
  const del = document.createElement('button');
  del.className = 'card__del';
  del.type = 'button';
  del.dataset.id = item.id;
  del.title = '삭제';
  del.setAttribute('aria-label', `${item.label || '타임카드'} 삭제`);
  del.textContent = '✕';

  // 제목: 클릭하면 그 자리에서 바로 수정. 비어 있으면 '＋ 제목' 안내. 제목 있으면 [제목] 칩.
  const labelEl = document.createElement('button');
  labelEl.type = 'button';
  labelEl.className = 'card__label' + (item.label ? '' : ' card__label--empty');
  labelEl.title = '클릭하여 제목 수정';
  labelEl.setAttribute('aria-label', `제목 수정: ${item.label || '없음'}`);
  const labelText = document.createElement('span');
  labelText.className = 'card__labeltext';
  labelText.textContent = item.label || '＋ 제목';
  labelEl.append(labelText);
  if (item.label) labelEl.append(chip('제목')); // 제목 있을 때만 [제목] 칩(값 자르고 칩은 고정)

  // 큰 시간 + 방향 칩(updateCard가 채움).
  const timeEl = document.createElement('div');
  timeEl.className = 'card__time';

  // 진행률 도넛+퍼센트(zone2, 미래 카드만). 클릭하면 진행 시작점 지정. 바·마커는 아래 전체폭 밴드로.
  const progressEl = document.createElement('div');
  progressEl.className = 'card__progress';
  progressEl.title = '클릭하여 진행 시작점 지정 (일시 · N% · 기간)';
  const pieEl = document.createElement('div');
  pieEl.className = 'card__pie'; // 도넛(원 테두리=진행, 가운데=%) — updateProgress가 갱신
  const pieLabelEl = document.createElement('span');
  pieLabelEl.className = 'card__pielabel';
  pieEl.append(pieLabelEl);
  const pctEl = document.createElement('span');
  pctEl.className = 'card__pct'; // 독립 퍼센트 텍스트(도넛과 별개 토글)
  progressEl.append(pieEl, pctEl);

  // 전체폭 시각화 밴드(2열 아래, zone2+zone3 폭): 미래=진행바+시작/현재/기준 마커,
  // 과거=등록/수정/기준/현재 타임라인. renderViz가 innerHTML로 채움.
  const vizEl = document.createElement('div');
  vizEl.className = 'card__viz';
  vizEl.hidden = true;

  // 기준일시(클릭 편집). 값 + [기준일시] 칩은 updateCard가 갱신. showTarget로 표시 토글.
  const metaEl = document.createElement('button');
  metaEl.type = 'button';
  metaEl.className = 'card__meta';
  metaEl.title = '클릭하여 기준일시 수정';
  metaEl.hidden = !settings.showTarget;

  // 등록/수정 일시 행(설정 토글, 전체폭).
  const createdRow = dateRow('등록일시', item.createdAt, settings.showCreated);
  const updatedRow = dateRow('수정일시', item.updatedAt, settings.showUpdated);

  // 태그(구 조합) 칩 줄: 소속 태그 + '＋ 태그' 추가 칩(클릭→팝오버). fillCardGroups가 채움.
  const groupsRow = document.createElement('div');
  groupsRow.className = 'card__groups';
  fillCardGroups(groupsRow, item.id);

  // 기록(랩) 버튼: 우측 레일 하단(예비 슬롯 자리). 좁은 레일이라 텍스트 대신 아이콘.
  const lapEl = document.createElement('button');
  lapEl.className = 'card__lap';
  lapEl.type = 'button';
  lapEl.dataset.id = item.id;
  lapEl.title = '지금 이 순간의 값을 기록(랩)';
  lapEl.setAttribute('aria-label', `${item.label || '타임카드'} 현재 값 기록`);
  lapEl.innerHTML =
    '<svg class="card__railicon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3a1 1 0 0 1 1 1v.5h9.2a.8.8 0 0 1 .66 1.25L14.4 9l1.46 3.25A.8.8 0 0 1 15.2 13.5H7v6.5a1 1 0 0 1-2 0V4a1 1 0 0 1 0-1Z"/></svg>';

  const lapsEl = document.createElement('ul');
  lapsEl.className = 'card__laps';

  // 좌측 열: 제목(상단) → 기준/등록/수정일시 → 진행률(좌측 폭만) → 태그. 모두 좌측·자르기.
  // 진행률을 좌측 열에 둬서 파이·바가 중앙 구분선을 넘어 우측 열을 침범하지 않게 한다.
  const left = document.createElement('div');
  left.className = 'card__col card__col--left';
  left.append(labelEl, metaEl, createdRow, updatedRow, progressEl, groupsRow);

  // 우측 열(zone3): 큰 시간(상단·우측·자동축소) → 기록(랩) 목록(우측 하단). 기록 버튼은 우측 레일.
  const right = document.createElement('div');
  right.className = 'card__col card__col--right';
  right.append(timeEl, lapsEl);

  const cols = document.createElement('div');
  cols.className = 'card__cols';
  cols.append(left, right);

  // 4열 구조: [좌 레일] [본문(=2열 cols + 인라인 에디터)] [우 레일].
  // 좌/우 레일은 상하 2등분 — 좌(핸들/숨기기), 우(✕/기록). 본문은 가운데 가변폭.
  const railLeft = document.createElement('div');
  railLeft.className = 'card__rail card__rail--left';
  railLeft.append(handle, hideBtn);

  const railRight = document.createElement('div');
  railRight.className = 'card__rail card__rail--right';
  railRight.append(del, lapEl); // 우상=삭제, 우하=기록

  const body = document.createElement('div');
  body.className = 'card__body';
  body.append(cols, vizEl); // 밴드는 2열 아래 전체폭

  card.append(railLeft, body, railRight);

  const refs = { card, timeEl, progressEl, pieEl, pieLabelEl, pctEl, vizEl, metaEl, lapsEl, item, dir: null };
  renderLaps(refs);
  updateCard(refs);
  return refs;
}

// 랩(기록) 1건을 {at, target}로 정규화. 옛 형식(ISO 문자열)은 카드의 현재 기준일시를 기준으로 본다.
//   at=기록 시각(스냅샷), target=그 기록이 향하던 기준일시(스냅샷). 둘 다 추후 수정 가능.
function normLap(lap, fallbackTarget) {
  if (typeof lap === 'string') return { at: lap, target: fallbackTarget };
  return { at: lap?.at, target: lap?.target ?? fallbackTarget };
}

// 상대시간 문자열 → 연동되는 기준일시 Date. at(기록 순간)을 기준점으로 부호 방향만큼 ±. 무효면 null.
// 부호가 없으면 그 기록의 현재 방향(남은/지난)을 유지한다.
function lapRelTarget(lap, relStr) {
  const p = parseRelative(relStr);
  const atMs = new Date(lap.at).getTime();
  if (!p || Number.isNaN(atMs)) return null;
  let dir = p.dir;
  if (!dir) dir = diff(new Date(lap.target), new Date(lap.at)).direction === 'past' ? 'past' : 'future';
  return new Date(dir === 'past' ? atMs - p.ms : atMs + p.ms);
}

// 기록(랩) 목록 렌더: 각 랩은 '기록 시각'과 '기준일시'(둘 다 편집 가능) + 둘로 계산한 상대값.
// 값은 데이터 변경 시에만 바뀌므로 매초 갱신(updateCard) 대신 여기서만 그린다.
function renderLaps(refs) {
  const laps = Array.isArray(refs.item.laps) ? refs.item.laps : [];
  refs.lapsEl.hidden = laps.length === 0;
  // 기록 2개 이상이면 가장 최근(laps[0])만 보이고 나머지는 접기/펼치기.
  const expanded = refs.lapsEl.dataset.expanded === '1';
  const shown = laps.length > 1 && !expanded ? laps.slice(0, 1) : laps;
  const makeLi = (lap, i) => {
    const { at, target } = normLap(lap, refs.item.targetISO);
    const r = diff(new Date(target), new Date(at)); // 상대시간 = 기준일시 − 기록시각(at=숨은 기준점)
    const d = DIRS[r.direction];
    const li = document.createElement('li');
    li.className = 'lap';
    // 편집 가능한 두 값(서로 연동): 상대시간 / 기준일시. 기록 시각(at)은 숨은 기준점이라 표시 안 함.
    const main = document.createElement('div');
    main.className = 'lap__main';
    // ① 상대시간(부호 + 듀레이션): 메인 시간과 동일 크기·굵기·방향색 + 방향 칩. 클릭→lap-rel 연동.
    const relBtn = document.createElement('button');
    relBtn.type = 'button';
    relBtn.className = 'lap__edit lap__edit--rel';
    relBtn.dataset.which = 'rel';
    relBtn.dataset.index = String(i);
    relBtn.title = `상대 시간 수정 (기준일시 연동) · ${d.label}`;
    const sign = d.sign ? `<span class="display__sign">${d.sign}</span>` : '';
    // 무채색 칩(방향=남은/지난시간). 시간 값은 자르고(ellipsis) 칩·연필은 고정.
    relBtn.innerHTML =
      `<span class="lap__val">${sign}${formatDuration(r)}</span>` +
      `<span class="chip">${d.chip}</span>`;
    // ② 기준일시: 값 + [기준일시] 칩(우측). 클릭→lap-target 연동.
    const targetBtn = document.createElement('button');
    targetBtn.type = 'button';
    targetBtn.className = 'lap__edit lap__edit--target';
    targetBtn.dataset.which = 'target';
    targetBtn.dataset.index = String(i);
    targetBtn.title = '기준일시 수정 (상대시간 연동)';
    targetBtn.innerHTML =
      `<span class="lap__edittext">${fmtDate(new Date(target))}</span><span class="chip">기준일시</span>`;
    main.append(relBtn, targetBtn);
    const del = document.createElement('button');
    del.className = 'lap__del';
    del.type = 'button';
    del.dataset.id = refs.item.id;
    del.dataset.index = String(i);
    del.title = '기록 삭제';
    del.setAttribute('aria-label', '기록 삭제');
    del.textContent = '✕';
    li.append(main, del);
    return li;
  };
  const kids = shown.map(makeLi);
  if (laps.length > 1) {
    const li = document.createElement('li');
    li.className = 'lap lap--more';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lap__more';
    btn.textContent = expanded ? '기록 접기' : `기록 ${laps.length - 1}개 더 보기`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      refs.lapsEl.dataset.expanded = expanded ? '' : '1';
      renderLaps(refs);
    });
    li.append(btn);
    kids.push(li);
  }
  refs.lapsEl.replaceChildren(...kids);
}

// 카드의 시간/색/메타만 갱신(DOM 구조는 그대로). 항상 '현재' 기준(기준일시는 불변).
function updateCard(refs) {
  const item = refs.item;
  const target = new Date(item.targetISO);
  const r = diff(target, new Date());
  const d = DIRS[r.direction];
  // className 통째로 덮어쓰면 드래그 중(card--dragging) 클래스가 지워지므로 toggle 사용.
  refs.card.classList.toggle('display--future', r.direction === 'future');
  refs.card.classList.toggle('display--past', r.direction === 'past');
  // 시간 + 방향 칩(남은시간/지난시간). 칩 색은 방향 따라(미래=초록/과거=빨강).
  refs.timeEl.innerHTML =
    `<span class="card__num">${d.sign ? `<span class="display__sign">${d.sign}</span>` : ''}${formatDuration(r)}</span>` +
    ` <span class="chip chip--${r.direction}">${d.chip}</span>`;
  // 기준일시: 값(자르기) + [기준일시] 칩(고정 → 날짜가 길어도 칩은 항상 보임).
  refs.metaEl.innerHTML = `<span class="card__metadate">${fmtDate(target)}</span><span class="chip">기준일시</span>`;
  updateProgress(refs, item, target, r.direction);
  fitTime(refs.timeEl); // 우측 열 폭에 맞게 폰트 자동 축소(오버플로우 방지)
  refs.dir = r.direction;
}

// 큰 시간이 우측 열을 넘치면(긴 기간 등) 폰트를 줄여 오버플로우를 없앤다.
// 가용폭은 부모 열(.card__col--right)의 안쪽 너비 기준으로 측정.
function fitTime(el) {
  el.style.fontSize = '';
  if (!el.clientWidth || el.scrollWidth <= el.clientWidth) return; // 레이아웃 전(0)·여유 있으면 그대로
  const base = parseFloat(getComputedStyle(el).fontSize);
  let size = Math.max(11, base * (el.clientWidth / el.scrollWidth) - 0.5); // 비율로 한 번에 근접
  el.style.fontSize = `${size}px`;
  let guard = 0;
  while (el.scrollWidth > el.clientWidth && size > 11 && guard++ < 10) {
    size -= 0.5;
    el.style.fontSize = `${size}px`;
  }
}

// 과거 카드 타임라인에 표시할 일시들(등록·수정·기준·현재). 같은 시각은 색만 다르게 겹쳐 표시.
const TL_POINTS = [
  { key: 'created', label: '등록', isoOf: (it) => it.createdAt, cls: 'tl--created' },
  { key: 'updated', label: '수정', isoOf: (it) => it.updatedAt, cls: 'tl--updated' },
  { key: 'target', label: '기준', isoOf: (it) => it.targetISO, cls: 'tl--target' },
];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 진행률 시각화: zone2 도넛/%(미래) + 전체폭 밴드(미래=진행바+시작/현재/기준, 과거=등록/수정/기준/현재).
function updateProgress(refs, item, target, direction) {
  const show = settings.progressShow;
  const order = settings.progressOrder;
  const future = direction === 'future';
  // zone2: 도넛 + 독립 % (미래 + pie/percent 토글)
  if (future && (show.pie || show.percent)) {
    const start =
      item.startISO || (settings.progressBase === 'updated' ? item.updatedAt : item.createdAt) || item.createdAt;
    const f = elapsedFraction(start, target);
    const pctRound = Math.round(f * 100);
    refs.progressEl.hidden = false;
    refs.pieEl.style.background = `conic-gradient(var(--future) ${(f * 100).toFixed(1)}%, var(--track) 0)`;
    // 도넛 가운데 %는 독립 퍼센트가 꺼졌을 때만(둘 다 켜면 %가 두 번 나오던 문제 수정 → 도넛은 링만).
    refs.pieLabelEl.textContent = show.percent ? '' : `${pctRound}%`;
    refs.pctEl.textContent = `${pctRound}%`;
    refs.pieEl.hidden = !show.pie;
    refs.pctEl.hidden = !show.percent;
    refs.pieEl.style.order = order.indexOf('pie'); // 도넛↔% 순서(설정)
    refs.pctEl.style.order = order.indexOf('percent');
    refs.progressEl.setAttribute('aria-label', `진행률 ${pctRound}%`);
  } else {
    refs.progressEl.hidden = true;
  }
  // 전체폭 밴드: 미래는 bar 토글 시, 과거는 항상.
  if (future && !show.bar) refs.vizEl.hidden = true;
  else renderViz(refs, item, direction);
}

// 전체폭 밴드(미래/과거 공통): 트랙 + 채움(미래=시작→현재 청색 / 과거=기준→현재 적색) + ▲마커 + 라벨.
// 라벨은 카테고리명만(컴팩트 일시는 마커·라벨 hover 툴팁에만). 겹치면 최소 행 stagger.
function renderViz(refs, item, direction) {
  const future = direction === 'future';
  const now = Date.now();
  let pts;
  if (future) {
    const start = item.startISO || (settings.progressBase === 'updated' ? item.updatedAt : item.createdAt) || item.createdAt;
    pts = [
      { cls: 'tl--start', label: '시작', ms: new Date(start).getTime() },
      { cls: 'tl--now', label: '현재', ms: now },
      { cls: 'tl--target', label: '기준', ms: new Date(item.targetISO).getTime() },
    ];
  } else {
    pts = TL_POINTS.map((p) => ({ cls: p.cls, label: p.label, ms: new Date(p.isoOf(item)).getTime() }))
      .filter((p) => Number.isFinite(p.ms))
      .concat([{ cls: 'tl--now', label: '현재', ms: now }])
      .sort((a, b) => a.ms - b.ms);
  }
  const min = Math.min(...pts.map((p) => p.ms));
  const max = Math.max(...pts.map((p) => p.ms));
  // 채움 구간(트랙 0~1): 미래=시작(0)→현재 / 과거=기준→현재(=1).
  const fillA = future ? 0 : elapsedFraction(min, max, new Date(item.targetISO).getTime());
  const fillB = future ? elapsedFraction(min, max, now) : 1;
  refs.vizEl.hidden = false;
  refs.vizEl.classList.toggle('card__viz--editable', future); // 미래 바 클릭 → 시작점 편집
  refs.vizEl.classList.toggle('card__viz--past', !future); // 과거 = 적색 채움
  // 라벨(카테고리명만) 위치는 px로 충돌 회피(밴드 폭 기준). 삽입 전(0)이면 근사폭.
  const W = refs.vizEl.clientWidth || 240;
  const ROW_H = 12;
  const GAP = 5;
  const items = pts.map((p) => {
    const f = elapsedFraction(min, max, p.ms);
    const xPct = 8 + f * 84; // 8~92%: 가장자리 라벨 잘림 방지
    return { ...p, xPct, xPx: (xPct / 100) * W, w: p.label.length * 9 + 6, date: formatCompact(new Date(p.ms)) };
  });
  const sorted = [...items].sort((a, b) => a.xPx - b.xPx);
  const rowRight = [];
  for (const it of sorted) {
    let r = 0;
    while (r < rowRight.length && it.xPx - it.w / 2 < rowRight[r] + GAP) r++;
    it.row = r;
    rowRight[r] = it.xPx + it.w / 2;
  }
  const rows = Math.max(1, rowRight.length);
  const marks = items
    .map(
      (it) =>
        `<span class="card__vizmark ${it.cls}" style="left:${it.xPct.toFixed(1)}%" title="${esc(it.label)} ${it.date}"></span>`,
    )
    .join('');
  const labels = items
    .map(
      (it) =>
        `<span class="card__vizlabel ${it.cls}" style="left:${it.xPct.toFixed(1)}%;top:${it.row * ROW_H}px" ` +
        `title="${esc(it.label)} ${it.date}">${esc(it.label)}</span>`,
    )
    .join('');
  refs.vizEl.innerHTML =
    `<div class="card__viz-bar"><div class="card__viz-track">` +
    `<div class="card__viz-fill" style="left:${(fillA * 100).toFixed(1)}%;width:${((fillB - fillA) * 100).toFixed(1)}%"></div>` +
    `</div>${marks}</div>` +
    `<div class="card__viz-labels" style="height:${rows * ROW_H}px">${labels}</div>`;
  refs.vizEl.setAttribute('aria-label', future ? '진행률 타임라인' : '등록·수정·기준·현재 일시 타임라인');
}

// 데이터 변경 시: 저장된(수동) 순서 그대로 목록 DOM 재구성.
// viewFilter가 있으면 그에 맞는 항목만 보여준다(조합/날짜/항목).
function rebuild() {
  let shown = list;
  if (viewFilter?.kind === 'group') {
    const g = loadGroups(localStorage).find((x) => x.id === viewFilter.id);
    if (g) shown = list.filter((t) => g.itemIds.includes(t.id));
    else viewFilter = null; // 그룹이 사라졌으면 필터 해제
  } else if (viewFilter?.kind === 'date') {
    shown = list.filter((t) => dateKeyOf(t, viewFilter.basis) === viewFilter.key);
  } else if (viewFilter?.kind === 'item') {
    shown = list.filter((t) => t.id === viewFilter.id);
  }
  // '현재 화면에서 숨기기'한 카드는 숨김 보기 모드가 아니면 목록에서 제외.
  const hiddenCount = list.filter((t) => t.hidden).length;
  if (!showHidden) shown = shown.filter((t) => !t.hidden);
  updateHiddenBar(hiddenCount);
  // 빈 상태: 전체/필터 보기 모두 맥락에 맞는 안내를 보여준다(필터 빈 화면 공백 방지).
  emptyHint.hidden = shown.length > 0;
  if (shown.length === 0) {
    emptyHint.textContent = viewFilter
      ? viewFilter.kind === 'group'
        ? '이 태그에 속한 타임카드가 없습니다.'
        : viewFilter.kind === 'date'
          ? '이 날짜에 해당하는 타임카드가 없습니다.'
          : '해당 타임카드가 없습니다.'
      : hiddenCount > 0 && !showHidden
        ? '모든 타임카드가 숨겨져 있습니다. 아래 “보기”로 다시 표시할 수 있습니다.'
        : '아직 타임카드가 없습니다. 오른쪽 아래 ＋ 버튼으로 추가하세요.';
  }
  refsList = shown.map(makeCard);
  listEl.replaceChildren(...refsList.map((r) => r.card));
  for (const r of refsList) fitTime(r.timeEl); // DOM 삽입 후 폭 확정 → 시간 자동 축소
  if (selectMode) {
    for (const r of refsList) r.card.classList.toggle('card--selected', selectedIds.has(r.item.id));
  }
}

// 보기 필터를 적용/해제하고 배너·드로어·목록을 갱신.
function applyFilter(filter, bannerText) {
  viewFilter = filter;
  groupBanner.hidden = !filter;
  if (filter) groupBannerName.textContent = bannerText;
  closeDrawer(); // 캘린더/조합 드로어가 열려 있으면 닫고 목록으로
  rebuild();
}
function clearViewFilter() {
  viewFilter = null;
  groupBanner.hidden = true;
  rebuild();
}

// 숨긴 카드 안내/토글 바: 숨긴 카드가 있을 때만 표시. 0개면 숨김 보기 모드도 해제.
function updateHiddenBar(count) {
  if (count <= 0) {
    showHidden = false;
    hiddenBar.hidden = true;
    return;
  }
  hiddenBar.hidden = false;
  hiddenBar.classList.toggle('hidden-bar--on', showHidden);
  hiddenBarName.textContent = showHidden ? `숨긴 타임카드 ${count}개 표시 중` : `숨긴 타임카드 ${count}개`;
  hiddenBarToggle.textContent = showHidden ? '숨기기' : '보기';
}
hiddenBarToggle.addEventListener('click', () => {
  showHidden = !showHidden;
  rebuild();
});

// 매초: 각 카드 시간/색만 갱신. 수동 순서이므로 경계 넘어도 재정렬하지 않음.
function tick() {
  for (const r of refsList) updateCard(r);
}

function updatePreview() {
  const raw = textInput.value.trim();
  if (raw === '') {
    textPreview.className = 'zone__preview preview--idle';
    textPreview.textContent = '기준일시를 입력하면 해석 결과가 표시됩니다.';
    return;
  }
  const d = parseFlexible(raw);
  if (!d) {
    textPreview.className = 'zone__preview preview--err';
    textPreview.textContent = '인식할 수 없는 형식입니다.';
    return;
  }
  const r = diff(d);
  const dir = DIRS[r.direction];
  // 해석된 기준일시까지/부터 남은·지난 양도 함께(방향 라벨 우측 빈 공간 활용).
  const amount = r.direction === 'now' ? '' : `  ·  ${formatDuration(r)}`;
  textPreview.className = 'zone__preview preview--ok';
  textPreview.textContent = `${formatLocal(d)}  ·  ${dir.label}${amount}`;
}

function addFrom(source) {
  let date;
  if (source === 'picker') {
    date = pickerDate(); // 달력에서 고른 날짜 + 시간
    if (!date) {
      alert('달력에서 날짜를 먼저 클릭하세요.');
      return;
    }
  } else {
    date = parseFlexible(textInput.value.trim());
    if (!date) {
      textPreview.className = 'zone__preview preview--err';
      textPreview.textContent = '인식할 수 없는 형식입니다.';
      return;
    }
  }
  // 제목을 비우면 자동 생성하지 않고 빈 채로 둠(기준일시는 메타에 따로 표시 → 중복 제거).
  const labelText = labelInput.value.trim();
  const item = add(localStorage, { label: labelText, targetISO: toLocalISO(date) });
  list = load(localStorage);
  // 추가 위치 설정: 기본 'top'이면 방금 추가한 항목을 맨 앞으로 재배치(영속).
  if (settings.addPosition === 'top') {
    list = reorder(localStorage, [item.id, ...list.filter((t) => t.id !== item.id).map((t) => t.id)]);
  }
  labelInput.value = '';
  if (source === 'text') {
    textInput.value = '';
    updatePreview();
  }
  // 보기 필터 중이었다면 해제해 새 카드가 보이게.
  viewFilter = null;
  groupBanner.hidden = true;
  rebuild();
  closeDrawer();
  srStatus.textContent = `${labelText || '타임카드'} 추가됨`;
}

// ── 드로어(추가/설정 공용): FAB로 열고, 배경/✕/Esc로 닫기 ──
let lastFocus = null;
let openEl = null;
function openDrawer(el, trigger, focusEl) {
  lastFocus = document.activeElement;
  el.hidden = false;
  openEl = el;
  if (trigger) trigger.setAttribute('aria-expanded', 'true');
  (focusEl || el.querySelector('input, select, button:not([data-close])'))?.focus();
}
function closeDrawer() {
  if (fmtPopOpen) closeFmtPop(); // 드로어 닫히면 형식 팝오버도 닫음
  if (!openEl) return;
  openEl.hidden = true;
  openEl = null;
  fab.setAttribute('aria-expanded', 'false');
  settingsFab.setAttribute('aria-expanded', 'false');
  groupsFab.setAttribute('aria-expanded', 'false');
  calendarFab.setAttribute('aria-expanded', 'false');
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

// 이벤트 배선 — 추가 흐름: 기준일시 입력 → Enter → (제목 입력 →) Enter → 생성.
// ① 기준일시→Enter→Enter(빈 제목): 기준일시 자동 제목으로 생성.
// ② 기준일시→Enter→제목 입력→Enter: 그 제목으로 생성.
// (Beeftext 무클릭 호환은 JS로 불가 확인 — 자동 포커스 유지, 확장기는 클릭/→ 1회 필요.)
textInput.addEventListener('input', updatePreview);
// 핵심: '다음 칸(제목)으로 넘어가는 모든 경로'(탭/엔터/모바일'다음'/클릭)에서 기준일시가
// 비어 있으면 현재시각 자동 채움. 키보드 키 대신 제목의 focus를 트리거로 써서 플랫폼 무관 동작.
labelInput.addEventListener('focus', () => {
  if (textInput.value.trim() === '') fillNow(false); // 포커스는 제목에 유지(채우기만)
});
// PC Enter: 비었거나 유효하면 제목으로 이동(이동 시 위 focus 핸들러가 채움), 무효면 오류 표시.
textInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return; // IME 조합 중 Enter 무시
  e.preventDefault(); // form 제출 막고 직접 처리
  const v = textInput.value.trim();
  if (v === '' || parseFlexible(v)) labelInput.focus();
  else updatePreview();
});
// 현재시각을 기준일시에 채움. focusField=true면 기준일시로 포커스(편집), false면 포커스 유지(이동 중).
function fillNow(focusField = true) {
  textInput.value = compactNow();
  updatePreview();
  if (focusField) {
    textInput.focus();
    const end = textInput.value.length;
    textInput.setSelectionRange(end, end);
  }
}
nowBtn.addEventListener('click', () => fillNow(true));
// '오늘' 버튼: 오늘 날짜를 YYMMDD(예 260628)로 채움(시간 없이). parseFlexible가 6자리 날짜로 해석.
todayBtn.addEventListener('click', () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  textInput.value = `${String(d.getFullYear()).slice(-2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  updatePreview();
  textInput.focus();
  const end = textInput.value.length;
  textInput.setSelectionRange(end, end);
});
// '지원 형식' 버튼: 형식 도움말을 버튼 옆 팝오버로 표시(인라인 아래 펼침 대신).
// 드로어 패널은 transform 애니가 있어 내부 position:fixed가 어긋남 → 열 때 body로 옮겨 뷰포트 기준 배치.
let fmtPopOpen = false;
function openFmtPop() {
  if (addFormatsEl.parentElement !== document.body) document.body.append(addFormatsEl);
  addFormatsEl.hidden = false;
  const r = fmtBtn.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 16);
  addFormatsEl.style.width = `${w}px`;
  addFormatsEl.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  addFormatsEl.style.top = `${r.bottom + 6}px`;
  fmtBtn.setAttribute('aria-expanded', 'true');
  fmtPopOpen = true;
}
function closeFmtPop() {
  addFormatsEl.hidden = true;
  fmtBtn.setAttribute('aria-expanded', 'false');
  fmtPopOpen = false;
}
fmtBtn.addEventListener('click', (e) => {
  e.stopPropagation(); // 바깥-클릭 닫기로 전파 방지
  if (fmtPopOpen) closeFmtPop();
  else openFmtPop();
});
addFormatsEl.addEventListener('click', (e) => e.stopPropagation()); // 내부 클릭은 닫기 안 함
document.addEventListener('click', () => {
  if (fmtPopOpen) closeFmtPop();
});
// 추가: form submit(=PC Enter on 제목·모바일 완료/이동 액션키·＋추가 버튼) → 한 경로로 통일.
addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addFrom('text');
});
// 픽커의 '＋ 선택기로 추가'는 form 밖이라 클릭으로 처리(텍스트 ＋추가는 submit이라 중복 방지로 제외).
document.querySelectorAll('.zone__apply').forEach((btn) => {
  if (btn.type === 'submit') return;
  btn.addEventListener('click', () => addFrom(btn.dataset.source));
});
function itemById(id) {
  return list.find((t) => t.id === id);
}

// 랩(스냅샷) 기록: '지금 이 순간'(at)과 그때의 기준일시(target)를 함께 남긴다(최신 먼저).
// 둘 다 추후 수정 가능 → 기록 후 기준일시가 바뀌어도 이 기록은 독립적으로 유지된다.
function addLap(id) {
  const item = itemById(id);
  if (!item) return;
  const snap = { at: new Date().toISOString(), target: item.targetISO };
  const laps = [snap, ...(Array.isArray(item.laps) ? item.laps : [])];
  list = updateItem(localStorage, id, { laps });
  rebuild();
  srStatus.textContent = '현재 값 기록됨';
}

function removeLap(id, index) {
  const item = itemById(id);
  if (!item || !Array.isArray(item.laps)) return;
  list = updateItem(localStorage, id, { laps: item.laps.filter((_, i) => i !== index) });
  rebuild();
  srStatus.textContent = '기록 삭제됨';
}

// 진행 시작 입력의 'duration' 판별: d접두(d5h) 또는 무접두+명시적 단위(5시간/30분/5h).
// '시'(정각)·순수 숫자·날짜는 제외(= 일시로 해석) → '시간'만 시(hour) 단위로 본다.
const BARE_DUR = /^\d+\s*(?:[a-zA-Z]+|시간|분|초|일|개월|월|년)$/;
function asDuration(s) {
  let dur = parseDuration(s); // d 접두 형식
  if (!dur && BARE_DUR.test(s)) dur = parseDuration('d' + s); // 무접두 + 단위
  if (!dur) return null;
  const total = dur.years + dur.months + dur.days + dur.hours + dur.minutes + dur.seconds;
  return total > 0 ? dur : null;
}

// 진행 시작점 입력을 3가지 방식으로 해석 → 시작 Date(또는 기본=null).
//   ① 빈칸 → 기본(등록/수정일시)  ② 'N%' → 지금이 N%가 되는 시작 역산
//   ③ duration(5시간 등) → 기준일시 − 기간  ④ 일시 → 그 일시
function resolveProgressStart(raw, item) {
  const s = String(raw).trim();
  if (s === '') return { kind: 'default', date: null };
  const target = new Date(item.targetISO);
  const pm = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pm) {
    const pct = parseFloat(pm[1]);
    const date = new Date(startForFraction(Date.now(), target, pct / 100));
    return { kind: 'percent', date, pct };
  }
  const dur = asDuration(s);
  if (dur) {
    const d = new Date(target);
    d.setFullYear(d.getFullYear() - dur.years);
    d.setMonth(d.getMonth() - dur.months);
    d.setDate(d.getDate() - dur.days);
    d.setHours(d.getHours() - dur.hours);
    d.setMinutes(d.getMinutes() - dur.minutes);
    d.setSeconds(d.getSeconds() - dur.seconds);
    return { kind: 'duration', date: d };
  }
  const dt = parseFlexible(s);
  if (dt) return { kind: 'datetime', date: dt };
  return { kind: 'invalid' };
}

// ── 인라인 필드 편집: 제목/기준일시를 클릭하면 그 자리(필드 바로 아래)에 입력창이 열린다 ──
// field: 'title'(텍스트) | 'date'(자유 텍스트→해석). 한 카드에 하나만. 같은 필드 재클릭 시 닫힘(토글).
const FIELD_LABELS = {
  title: '제목 수정',
  date: '기준일시 수정',
  start: '진행 시작점 (일시 · N% · 기간)',
  'lap-rel': '상대 시간 수정 (기준일시 연동)',
  'lap-target': '기준일시 수정 (상대시간 연동)',
};
function openFieldEditor(card, id, field, lapIndex = null) {
  const lapKey = String(lapIndex ?? '');
  const existing = card.querySelector('.card__editor');
  if (existing) {
    const sameField = existing.dataset.field === field && existing.dataset.lap === lapKey;
    existing.remove(); // 다른 필드면 닫고 새로, 같은 필드(같은 기록)면 토글로 닫기만
    if (sameField) {
      card.removeAttribute('data-editing');
      return;
    }
  }
  const item = itemById(id);
  if (!item) return;
  // 랩 필드: 해당 기록의 at/target ISO를 프리필 값으로.
  const lap =
    lapIndex != null ? normLap((item.laps || [])[lapIndex], item.targetISO) : null;
  const editor = document.createElement('div');
  editor.className = 'card__editor';
  editor.dataset.field = field;
  editor.dataset.lap = lapKey;
  // 무엇을 수정하는지 명시하는 라벨(전체폭 첫 줄).
  const editLabel = document.createElement('span');
  editLabel.className = 'card__editlabel';
  editLabel.textContent = FIELD_LABELS[field] || '수정';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'card__editinput';
  input.autocomplete = 'off';
  if (field === 'lap-rel') {
    // 상대 시간: 부호+듀레이션(formatDuration 형식). 현재 표시값을 그대로 프리필.
    const rr = diff(new Date(lap.target), new Date(lap.at));
    input.value = (DIRS[rr.direction].sign || '') + formatDuration(rr);
    input.placeholder = '예: −1일 16:48:15  (− 남은 / + 지난)';
    input.spellcheck = false;
  } else if (field === 'lap-target') {
    // 기록의 기준일시: 자유 텍스트 → 해석. 현재값을 파싱 가능한 형태로 채운다.
    input.value = toLocalISO(new Date(lap.target)).replace('T', ' ');
    input.placeholder = '예: 260626금1800 · 2026-06-26 18:00 · 오후 6시';
    input.spellcheck = false;
  } else if (field === 'date') {
    // 기준일시도 추가영역처럼 '자유 텍스트 → 해석' 방식. 현재값을 파싱 가능한 형태로 채운다.
    input.value = toLocalISO(new Date(item.targetISO)).replace('T', ' ');
    input.placeholder = '예: 260626금1800 · 2026-06-26 18:00 · 오후 6시';
    input.spellcheck = false;
  } else if (field === 'start') {
    // 진행률 0% 기준을 이 카드만 따로 지정. 세 방식: 일시 · N%(지금이 그 %) · 기간(5시간).
    input.value = item.startISO ? toLocalISO(new Date(item.startISO)).replace('T', ' ') : '';
    input.placeholder = '일시 · 50%(지금이 그 %) · 5시간(기간) · 비우면 기본';
    input.spellcheck = false;
  } else {
    input.value = item.label || '';
    input.placeholder = '제목 (비우면 제목 없음)';
    input.maxLength = 100;
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitField(card, id, field);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editor.remove();
      card.removeAttribute('data-editing');
    }
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'card__save';
  save.textContent = '저장';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'card__cancel';
  cancel.textContent = '취소';
  editor.append(editLabel, input, save, cancel);

  // lap-rel: 상대시간을 입력하면 '연동될 기준일시'를 라이브 미리보기로 보여준다.
  if (field === 'lap-rel') {
    const preview = document.createElement('p');
    preview.className = 'card__editpreview';
    editor.append(preview);
    const refresh = () => {
      input.removeAttribute('aria-invalid');
      const t = lapRelTarget(lap, input.value);
      if (!t) {
        preview.textContent = input.value.trim() ? '인식할 수 없는 형식' : '';
        preview.dataset.ok = input.value.trim() ? 'no' : '';
        return;
      }
      preview.textContent = `기준일시 → ${formatLocal(t)}`;
      preview.dataset.ok = 'yes';
    };
    input.addEventListener('input', refresh);
    refresh();
  } else if (field === 'start') {
    // 진행 시작점: 일시 · N%(지금이 그 %) · 기간(5시간). 해석된 시작 일시를 미리보기.
    const preview = document.createElement('p');
    preview.className = 'card__editpreview';
    editor.append(preview);
    const KIND = { percent: '지금이 그 %', duration: '기준일시 − 기간', datetime: '시작 일시' };
    const refresh = () => {
      input.removeAttribute('aria-invalid');
      const r = resolveProgressStart(input.value, item);
      if (r.kind === 'default') {
        preview.textContent = '기본값(등록/수정일시) 사용';
        delete preview.dataset.ok;
      } else if (r.kind === 'invalid') {
        preview.textContent = '인식할 수 없는 형식';
        preview.dataset.ok = 'no';
      } else {
        preview.textContent = `시작 → ${formatLocal(r.date)} · ${KIND[r.kind]}`;
        preview.dataset.ok = 'yes';
      }
    };
    input.addEventListener('input', refresh);
    refresh();
  } else if (field === 'date' || field === 'lap-target') {
    // 기준일시/랩 기준일시: 입력하는 동안 해석 결과를 라이브 미리보기로 보여준다.
    const preview = document.createElement('p');
    preview.className = 'card__editpreview';
    editor.append(preview);
    const refresh = () => {
      input.removeAttribute('aria-invalid');
      const raw = input.value.trim();
      if (!raw) {
        preview.textContent = '';
        delete preview.dataset.ok;
        return;
      }
      const d = parseFlexible(raw);
      if (!d) {
        preview.textContent = '인식할 수 없는 형식';
        preview.dataset.ok = 'no';
        return;
      }
      const dir = DIRS[diff(d).direction];
      preview.textContent = `${formatLocal(d)} · ${dir.label}`;
      preview.dataset.ok = 'yes';
    };
    input.addEventListener('input', refresh);
    refresh();
  }

  // 편집기는 2열(.card__cols) 아래 전체폭으로 삽입(열 내부에 넣으면 레이아웃 깨짐).
  // 랩 필드도 우측 열 내부가 아니라 2열 아래 전체폭으로(좁은 열 깨짐 방지).
  const ANCHOR = { date: '.card__meta', start: '.card__progress', title: '.card__label' };
  const anchor = card.querySelector(ANCHOR[field] || '.card__cols');
  (anchor.closest('.card__cols, .card__row') || anchor).after(editor);
  card.dataset.editing = field; // 수정 중인 원본 필드를 CSS로 강조
  input.focus();
  input.select?.();
}

function commitField(card, id, field) {
  const editor = card.querySelector('.card__editor');
  const input = editor?.querySelector('.card__editinput');
  if (!input) return;
  if (field === 'lap-rel' || field === 'lap-target') {
    const item = itemById(id);
    const idx = +editor.dataset.lap;
    if (!item || !Array.isArray(item.laps) || item.laps[idx] == null) {
      rebuild();
      return;
    }
    const cur = normLap(item.laps[idx], item.targetISO);
    // 상대시간/기준일시 둘 다 결국 '기준일시(target)'를 바꾼다. at(기록 순간)은 고정 기준점.
    const target =
      field === 'lap-rel' ? lapRelTarget(cur, input.value) : parseFlexible(input.value);
    if (!target) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    const laps = item.laps.map((l, i) =>
      i === idx ? { ...normLap(l, item.targetISO), target: toLocalISO(target) } : l,
    );
    list = updateItem(localStorage, id, { laps });
    srStatus.textContent = field === 'lap-rel' ? '상대 시간 변경됨' : '기준일시 변경됨';
    rebuild();
    return;
  }
  if (field === 'date') {
    const date = parseFlexible(input.value);
    if (!date) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    list = updateItem(localStorage, id, { targetISO: toLocalISO(date) });
    srStatus.textContent = '기준일시 변경됨';
  } else if (field === 'start') {
    // 일시 · N%(지금이 그 %) · 기간(5시간) → 시작 일시 계산. 비우면 기본(등록/수정일시).
    const r = resolveProgressStart(input.value, itemById(id));
    if (r.kind === 'invalid') {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    list = updateItem(localStorage, id, { startISO: r.date ? toLocalISO(r.date) : null });
    srStatus.textContent = r.kind === 'default' ? '진행 시작 기본값으로' : '진행 시작 변경됨';
  } else {
    list = updateItem(localStorage, id, { label: input.value.trim() });
    srStatus.textContent = '제목 변경됨';
  }
  rebuild();
}

listEl.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (selectMode) {
    // 선택 모드: 카드 클릭은 조합 선택 토글만(다른 동작 막음).
    toggleSelect(card);
    return;
  }
  const lapDel = e.target.closest('.lap__del');
  if (e.target.closest('.card__del')) {
    list = remove(localStorage, id);
    removeItemFromGroups(localStorage, id); // 그룹 멤버에서도 제거(깨진 참조 방지)
    rebuild();
    srStatus.textContent = '타임카드 삭제됨';
  } else if (e.target.closest('.card__hide')) {
    const willHide = !itemById(id)?.hidden; // 현재 상태 반전(숨기기 ↔ 다시 표시)
    list = setHidden(localStorage, id, willHide);
    rebuild();
    srStatus.textContent = willHide ? '타임카드 숨김' : '타임카드 다시 표시';
  } else if (lapDel) {
    removeLap(id, +lapDel.dataset.index);
  } else if (e.target.closest('.lap__edit')) {
    const b = e.target.closest('.lap__edit'); // 기록의 상대시간/기준일시 인라인 수정(서로 연동)
    openFieldEditor(card, id, b.dataset.which === 'rel' ? 'lap-rel' : 'lap-target', +b.dataset.index);
  } else if (e.target.closest('.card__lap')) {
    addLap(id);
  } else if (e.target.closest('.card__save')) {
    commitField(card, id, card.querySelector('.card__editor')?.dataset.field);
  } else if (e.target.closest('.card__cancel')) {
    card.querySelector('.card__editor')?.remove();
    card.removeAttribute('data-editing');
  } else if (e.target.closest('.card__label')) {
    openFieldEditor(card, id, 'title');
  } else if (e.target.closest('.card__meta')) {
    openFieldEditor(card, id, 'date');
  } else if (e.target.closest('.card__progress, .card__viz--editable')) {
    openFieldEditor(card, id, 'start'); // 도넛/% 또는 미래 진행바 클릭 → 진행 시작점 지정
  } else if (e.target.closest('.card__group')) {
    viewGroup(e.target.closest('.card__group').dataset.gid); // 소속 조합 칩 → 그 조합 보기
  } else if (e.target.closest('.card__groupbtn')) {
    openComboPopover(e.target.closest('.card__groupbtn'), id); // ＋조합 → 토글 팝오버
  }
});

// 추가 드로어 열기: 선택기(달력)를 항상 보이게 초기화한 뒤 연다(접힘 없앰).
function openAddDrawer() {
  ensurePickerInit();
  openDrawer(drawer, fab, textInput);
}

// 드로어 열기/닫기 (추가 ＋ / 설정 ⚙️)
fab.addEventListener('click', openAddDrawer);
settingsFab.addEventListener('click', () => openSettings());
groupsFab.addEventListener('click', () => {
  renderGroups();
  openDrawer(groupsDrawer, groupsFab);
});
[drawer, settingsDrawer, groupsDrawer, calendarDrawer].forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeDrawer();
  });
});
// 전역 단축키: Esc는 항상 닫기. A=추가 드로어, S=설정 드로어.
// 물리 키(e.code)로 판정 → Shift 불필요 + 한글/기타 자판 배열에서도 동일하게 동작.
// (e.key는 한글 IME에서 'ㅁ'/'Process' 등으로 바뀌어 안 먹힘.) 넘패드 +도 추가로 허용.
// 단, 입력칸에 타이핑 중이거나 이미 드로어가 열려 있거나 수정자키와 함께면 무시(오작동 방지).
function isTyping(el) {
  return (
    el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (fmtPopOpen) closeFmtPop(); // 팝오버 먼저 닫기(드로어는 유지)
    else if (selectMode) exitSelectMode();
    else closeDrawer();
    return;
  }
  if (openEl || selectMode || isTyping(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'KeyA' || e.code === 'NumpadAdd') {
    e.preventDefault();
    openAddDrawer();
  } else if (e.code === 'KeyS') {
    e.preventDefault();
    openSettings();
  } else if (e.code === 'KeyC') {
    e.preventDefault();
    openCalendar();
  }
});

// ── 조합(그룹): 카드 다중 선택 → 이름 저장, 조합별 필터 보기 ──
function renderGroups() {
  const groups = loadGroups(localStorage);
  groupsEmpty.hidden = groups.length > 0;
  groupsListEl.replaceChildren(
    ...groups.map((g) => {
      const li = document.createElement('li');
      li.className = 'group';
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'group__name';
      name.dataset.id = g.id;
      name.title = '클릭하여 이름 변경';
      const nameText = document.createElement('span');
      nameText.className = 'group__nametext';
      nameText.textContent = g.name || '(이름 없음)';
      name.append(nameText);
      const count = document.createElement('span');
      count.className = 'group__count';
      count.textContent = `${(g.itemIds || []).length}개`;
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'group__view';
      view.dataset.id = g.id;
      view.textContent = '보기';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'group__del';
      del.dataset.id = g.id;
      del.title = '태그 삭제';
      del.setAttribute('aria-label', `${g.name || '태그'} 삭제`);
      del.textContent = '✕';
      li.append(name, count, view, del);
      return li;
    }),
  );
}

function viewGroup(id) {
  const g = loadGroups(localStorage).find((x) => x.id === id);
  if (!g) return;
  applyFilter({ kind: 'group', id }, `🏷 ${g.name || '태그'} · ${(g.itemIds || []).length}개`);
}

// ── 카드↔태그: 카드에 소속 태그 칩 표시 + '＋ 태그'로 추가/제거 ──
// 카드의 .card__groups 칸을 (소속 태그 칩들 + ＋태그)으로 다시 채운다.
const TAG_COLLAPSE = 3; // 이보다 많으면 나머지를 접고 '+N'으로 펼치기
function fillCardGroups(container, id) {
  const groups = groupsForItem(loadGroups(localStorage), id);
  const expanded = container.dataset.expanded === '1';
  const shown = groups.length > TAG_COLLAPSE && !expanded ? groups.slice(0, TAG_COLLAPSE) : groups;
  const kids = shown.map((g) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card__group';
    b.dataset.gid = g.id;
    b.textContent = g.name || '태그';
    b.title = `태그 "${g.name || ''}" 보기`;
    return b;
  });
  // 태그가 많으면 접기/펼치기 토글 칩(.card__tagmore: 리스트 위임의 .card__group과 구분).
  if (groups.length > TAG_COLLAPSE) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'card__tagmore';
    more.textContent = expanded ? '접기' : `+${groups.length - TAG_COLLAPSE}`;
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      container.dataset.expanded = expanded ? '' : '1';
      fillCardGroups(container, id);
    });
    kids.push(more);
  }
  // 끝에 '＋ 태그' 추가 칩(기록 액션과 구분되는 태그 전용 진입점).
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'card__groupbtn';
  addBtn.dataset.id = id;
  addBtn.title = '이 카드에 태그 추가/제거';
  addBtn.setAttribute('aria-label', '태그 추가 또는 제거');
  addBtn.textContent = '＋ 태그';
  container.replaceChildren(...kids, addBtn);
}
// 리스트에서 그 id 카드의 조합 칩만 다시 그린다(전체 rebuild 없이 즉시 반영).
function refreshCardGroups(id) {
  const row = listEl.querySelector(`.card[data-id="${id}"] .card__groups`);
  if (row) fillCardGroups(row, id);
}

// 조합 선택기(재사용): 컨테이너에 (기존 조합 토글 목록 + 새 조합 만들기)를 그린다.
// model = { isOn(gid), toggle(gid), onCreate(name), afterChange?() }
function renderComboChooser(container, model) {
  const groups = loadGroups(localStorage);
  const listBox = document.createElement('div');
  listBox.className = 'combo__list';
  if (groups.length === 0) {
    const p = document.createElement('p');
    p.className = 'combo__empty';
    p.textContent = '저장된 태그가 없습니다. 아래에서 새로 만들어 보세요.';
    listBox.append(p);
  } else {
    for (const g of groups) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'combo__opt';
      opt.setAttribute('aria-pressed', String(model.isOn(g.id)));
      const check = document.createElement('span');
      check.className = 'combo__check';
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      const nm = document.createElement('span');
      nm.className = 'combo__optname';
      nm.textContent = g.name || '태그';
      opt.append(check, nm);
      opt.addEventListener('click', () => {
        model.toggle(g.id);
        model.afterChange?.();
        renderComboChooser(container, model);
      });
      listBox.append(opt);
    }
  }
  const newWrap = document.createElement('div');
  newWrap.className = 'combo__new';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'combo__newname';
  input.placeholder = '새 태그 이름';
  input.autocomplete = 'off';
  const addB = document.createElement('button');
  addB.type = 'button';
  addB.className = 'combo__add';
  addB.textContent = '＋ 만들기';
  const create = () => {
    const name = input.value.trim();
    if (!name) return;
    model.onCreate(name);
    model.afterChange?.();
    renderComboChooser(container, model);
  };
  addB.addEventListener('click', create);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      create();
    }
  });
  newWrap.append(input, addB);
  container.replaceChildren(listBox, newWrap);
}

// 카드의 '＋ 태그' 칩 옆에 뜨는 작은 팝오버(태그 토글/생성).
let comboPopEl = null;
function closeComboPopover() {
  comboPopEl?.remove();
  comboPopEl = null;
}
function openComboPopover(anchorEl, itemId) {
  closeComboPopover();
  closeItemMenu();
  const pop = document.createElement('div');
  pop.className = 'combo-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '태그에 추가/제거');
  // 내부 클릭은 바깥-클릭 닫기로 전파하지 않음(토글 시 재렌더로 타깃이 분리돼 오닫힘 방지).
  pop.addEventListener('click', (e) => e.stopPropagation());
  renderComboChooser(pop, {
    isOn: (gid) => groupsForItem(loadGroups(localStorage), itemId).some((g) => g.id === gid),
    toggle: (gid) => toggleItemInGroup(localStorage, gid, itemId),
    onCreate: (name) => addGroup(localStorage, { name, itemIds: [itemId] }),
    afterChange: () => refreshCardGroups(itemId),
  });
  document.body.append(pop);
  const r = anchorEl.getBoundingClientRect();
  const w = 240;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - 16)}px`;
  comboPopEl = pop;
  pop.querySelector('.combo__newname')?.focus();
}

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  viewFilter = null; // 전체 카드에서 선택하도록 필터 해제
  groupBanner.hidden = true;
  document.body.classList.add('select-mode');
  selectBar.hidden = false;
  groupNameInput.value = '';
  updateSelectCount();
  closeDrawer();
  rebuild();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  document.body.classList.remove('select-mode');
  selectBar.hidden = true;
  rebuild();
}

function toggleSelect(card) {
  const id = card.dataset.id;
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  card.classList.toggle('card--selected', selectedIds.has(id));
  updateSelectCount();
}

function updateSelectCount() {
  selectCountEl.textContent = `${selectedIds.size}개 선택`;
  selectSaveBtn.disabled = selectedIds.size === 0;
}

function saveGroup() {
  if (selectedIds.size === 0) return;
  const name = groupNameInput.value.trim() || `태그 (${selectedIds.size}개)`;
  addGroup(localStorage, { name, itemIds: [...selectedIds] });
  srStatus.textContent = `태그 "${name}" 저장됨`;
  exitSelectMode();
}

// 태그 이름 변경: 이름 버튼 클릭 → 그 자리에 입력창. Enter/포커스아웃=저장, Esc=취소.
function startRenameGroup(nameBtn, id) {
  const g = loadGroups(localStorage).find((x) => x.id === id);
  if (!g) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'group__rename';
  input.value = g.name || '';
  input.maxLength = 40;
  input.setAttribute('aria-label', '태그 이름');
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const nm = input.value.trim();
    if (save && nm && nm !== g.name) {
      renameGroup(localStorage, id, nm);
      if (viewFilter?.kind === 'group' && viewFilter.id === id) viewGroup(id); // 배너 텍스트 갱신
      rebuild(); // 카드의 태그 칩 이름 갱신
    }
    renderGroups();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // 드로어가 닫히지 않게
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  nameBtn.replaceWith(input);
  input.focus();
  input.select();
}

groupsNewBtn.addEventListener('click', enterSelectMode);
groupsListEl.addEventListener('click', (e) => {
  const view = e.target.closest('.group__view');
  const del = e.target.closest('.group__del');
  const nameBtn = e.target.closest('.group__name');
  if (nameBtn) startRenameGroup(nameBtn, nameBtn.dataset.id);
  else if (view) viewGroup(view.dataset.id);
  else if (del) {
    removeGroup(localStorage, del.dataset.id);
    if (viewFilter?.kind === 'group' && viewFilter.id === del.dataset.id) clearViewFilter();
    renderGroups();
    rebuild(); // 카드의 소속 태그 칩 갱신
    srStatus.textContent = '태그 삭제됨';
  }
});
selectSaveBtn.addEventListener('click', saveGroup);
selectCancelBtn.addEventListener('click', exitSelectMode);
groupNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveGroup();
  }
});
groupBannerClear.addEventListener('click', clearViewFilter);

// ── 캘린더(P3/P4): 선택 기준(기준/등록/수정)별 월 그리드. 각 날 제목 미니목록 + "+N" ──
let calYear = new Date().getFullYear();
let calMonth0 = new Date().getMonth();
let calBasis = 'target'; // 'target'|'created'|'updated'
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad2c = (n) => String(n).padStart(2, '0');

// ── 달력 선택기(추가 드로어): 연도(10칩 십년뷰) | 월(2열 칩) | 일(달력) + 시간 텍스트 해석 ──
let pickYear = new Date().getFullYear();
let pickMonth0 = new Date().getMonth();
let pickDay = new Date().getDate();
let pickYearBase = Math.floor(pickYear / 10) * 10; // 연도 칩 십년뷰 시작(x0)

// 시간 텍스트를 해석(기준일시와 동일 파서). 비우면 0시, 해석 불가면 null.
function pickTimeParts() {
  const raw = pickTime.value.trim();
  if (!raw) return { h: 0, m: 0, s: 0 };
  const t = parseFlexible(raw);
  if (!t) return null;
  return { h: t.getHours(), m: t.getMinutes(), s: t.getSeconds() };
}
function pickerDate() {
  const tp = pickTimeParts();
  if (!tp) return null;
  return new Date(pickYear, pickMonth0, pickDay, tp.h, tp.m, tp.s);
}
function pickSummary() {
  const d = pickerDate();
  if (!d) {
    pickSelEl.textContent = '시간 해석 불가 — 예: 1430 · 오후 2시';
    pickSelEl.dataset.ok = 'no';
    return;
  }
  pickSelEl.textContent = `선택: ${formatLocal(d)}`;
  pickSelEl.dataset.ok = 'yes';
}
function pickOpt(label, sel, now, data, extra) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'pick__opt' + (sel ? ' pick__opt--sel' : '') + (now ? ' pick__opt--now' : '') + (extra || '');
  Object.assign(b.dataset, data);
  b.textContent = label;
  return b;
}
// 연도: 현재 십년뷰(x0~x9) 10개를 2열 칩으로. 텍스트 입력엔 선택 연도 표시.
function renderYears() {
  const ty = new Date().getFullYear();
  const opts = [];
  for (let i = 0; i < 10; i++) {
    const y = pickYearBase + i;
    opts.push(pickOpt(y, y === pickYear, y === ty, { year: y }));
  }
  pickYearsEl.replaceChildren(...opts);
  if (document.activeElement !== pickYInput) pickYInput.value = pickYear;
}
// 월: 12개를 2열 칩으로 모두 표시(스크롤 없음).
function renderMonths() {
  const now = new Date();
  const thisYear = pickYear === now.getFullYear();
  const opts = [];
  for (let m = 0; m < 12; m++) {
    // 0패딩(01월~12월)으로 칩 가로폭 고정 → 폭이 변하지 않음.
    opts.push(pickOpt(`${pad2c(m + 1)}월`, m === pickMonth0, thisYear && m === now.getMonth(), { month: m }));
  }
  pickMonthsEl.replaceChildren(...opts);
}
// 일: 기존 달력 그리드(요일헤더 + 날짜). 다른 달 날짜 클릭 시 그 달로 이동.
function renderDays() {
  pickMlabelEl.textContent = `${pickYear}년 ${pad2c(pickMonth0 + 1)}월`; // 0패딩 → 라벨 폭 고정
  const dim = new Date(pickYear, pickMonth0 + 1, 0).getDate();
  if (pickDay > dim) pickDay = dim; // 월/연 바뀌어 일수가 줄면 클램프
  const ws = settings.weekStart === 'sun' ? 0 : 1;
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${pad2c(now.getMonth() + 1)}-${pad2c(now.getDate())}`;
  const selKey = `${pickYear}-${pad2c(pickMonth0 + 1)}-${pad2c(pickDay)}`;
  const cells = [];
  for (let i = 0; i < 7; i++) {
    const w = WD[(ws + i) % 7];
    const h = document.createElement('div');
    h.className = 'cal__wd' + (w === '일' ? ' cal__wd--sun' : w === '토' ? ' cal__wd--sat' : '');
    h.textContent = w;
    cells.push(h);
  }
  for (const week of monthGrid(pickYear, pickMonth0, ws, 6)) {
    // 항상 6주(42칸) 고정 → 월마다 높이가 안 바뀌어 아래 버튼 위치가 안 흔들림.
    for (const day of week) {
      const key = `${day.y}-${pad2c(day.m + 1)}-${pad2c(day.d)}`;
      const dow = new Date(day.y, day.m, day.d).getDay();
      const b = document.createElement('button');
      b.type = 'button';
      b.className =
        'pick__day' +
        (day.inMonth ? '' : ' pick__day--out') +
        (key === todayKey ? ' pick__day--today' : '') +
        (key === selKey ? ' pick__day--sel' : '') +
        (dow === 0 ? ' pick__day--sun' : dow === 6 ? ' pick__day--sat' : '');
      b.dataset.y = day.y;
      b.dataset.m = day.m;
      b.dataset.d = day.d;
      b.textContent = day.d;
      cells.push(b);
    }
  }
  pickDaysEl.replaceChildren(...cells);
}
function renderPickerCalendar() {
  renderYears();
  renderMonths();
  renderDays();
  pickSummary();
}
// 선택 연도 설정 + 십년뷰를 그 연도 십년대로 동기화.
function setPickYear(y) {
  pickYear = y;
  pickYearBase = Math.floor(y / 10) * 10;
}
function ensurePickerInit() {
  const now = new Date();
  setPickYear(now.getFullYear());
  pickMonth0 = now.getMonth();
  pickDay = now.getDate();
  pickTime.value = `${pad2c(now.getHours())}${pad2c(now.getMinutes())}`;
  renderPickerCalendar();
}
pickYearsEl.addEventListener('click', (e) => {
  const b = e.target.closest('.pick__opt');
  if (!b) return;
  pickYear = +b.dataset.year; // 칩은 현재 십년뷰 안 → base 유지
  renderPickerCalendar();
});
// 연도 텍스트 입력: 유효한 연도면 점프, 무효면 복원.
function applyYearInput() {
  const y = parseInt(pickYInput.value, 10);
  if (Number.isInteger(y) && y >= 1 && y <= 9999) {
    setPickYear(y);
    renderPickerCalendar();
  } else {
    pickYInput.value = pickYear;
  }
}
pickYInput.addEventListener('change', applyYearInput);
pickYInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); applyYearInput(); pickYInput.blur(); }
});
// 연도 십년뷰 이동(prev/next 10년): 선택은 유지, 칩 범위만 이동.
pickYPrevBtn.addEventListener('click', () => { pickYearBase -= 10; renderYears(); });
pickYNextBtn.addEventListener('click', () => { pickYearBase += 10; renderYears(); });
pickMonthsEl.addEventListener('click', (e) => {
  const b = e.target.closest('.pick__opt');
  if (!b) return;
  pickMonth0 = +b.dataset.month;
  renderMonths();
  renderDays();
  pickSummary();
});
pickDaysEl.addEventListener('click', (e) => {
  const b = e.target.closest('.pick__day');
  if (!b) return;
  setPickYear(+b.dataset.y); // 다른 달 날짜를 누르면 그 달/해로 이동
  pickMonth0 = +b.dataset.m;
  pickDay = +b.dataset.d;
  renderPickerCalendar();
});
// 일 달력 헤더: « ‹ [연/월] › » (이전/다음 해·달). 해 경계 넘으면 십년뷰도 동기화.
pickPrevBtn.addEventListener('click', () => {
  if (--pickMonth0 < 0) { pickMonth0 = 11; setPickYear(pickYear - 1); }
  renderPickerCalendar();
});
pickNextBtn.addEventListener('click', () => {
  if (++pickMonth0 > 11) { pickMonth0 = 0; setPickYear(pickYear + 1); }
  renderPickerCalendar();
});
pickDYPrevBtn.addEventListener('click', () => { setPickYear(pickYear - 1); renderPickerCalendar(); });
pickDYNextBtn.addEventListener('click', () => { setPickYear(pickYear + 1); renderPickerCalendar(); });
pickTime.addEventListener('input', pickSummary);

function renderCalendar() {
  calMonthEl.textContent = `${calYear}년 ${calMonth0 + 1}월`;
  const byDate = new Map(); // 선택 기준(calBasis) 날짜키 → 항목들
  for (const it of list) {
    const k = dateKeyOf(it, calBasis);
    if (!k) continue;
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(it);
  }
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${pad2c(now.getMonth() + 1)}-${pad2c(now.getDate())}`;
  const ws = settings.weekStart === 'sun' ? 0 : 1; // 시작 요일

  // 요일 헤더를 시작 요일에 맞춰 회전. 주말 색은 위치 아닌 실제 요일(일/토)로.
  const cells = Array.from({ length: 7 }, (_, i) => {
    const w = WD[(ws + i) % 7];
    const h = document.createElement('div');
    h.className = 'cal__wd' + (w === '일' ? ' cal__wd--sun' : w === '토' ? ' cal__wd--sat' : '');
    h.textContent = w;
    return h;
  });
  for (const week of monthGrid(calYear, calMonth0, ws)) {
    for (const day of week) {
      const key = `${day.y}-${pad2c(day.m + 1)}-${pad2c(day.d)}`;
      const cell = document.createElement('div');
      cell.className =
        'cal__day' + (day.inMonth ? '' : ' cal__day--out') + (key === todayKey ? ' cal__day--today' : '');
      cell.dataset.date = key;
      const num = document.createElement('div');
      num.className = 'cal__daynum';
      num.textContent = day.d;
      cell.append(num);
      const items = byDate.get(key) || [];
      if (items.length) {
        cell.classList.add('cal__day--has');
        const ul = document.createElement('ul');
        ul.className = 'cal__items';
        const MAX = 3;
        for (const it of items.slice(0, MAX)) {
          const li = document.createElement('li');
          li.className = 'cal__item';
          li.dataset.id = it.id;
          li.textContent = it.label || '(제목 없음)';
          li.title = it.label || '';
          ul.append(li);
        }
        if (items.length > MAX) {
          const more = document.createElement('li');
          more.className = 'cal__more';
          more.textContent = `+${items.length - MAX}`;
          ul.append(more);
        }
        cell.append(ul);
      }
      cells.push(cell);
    }
  }
  calGridEl.replaceChildren(...cells);
  syncSeg(calBasisSel, calBasis);
  syncSeg(calWeekstartSel, settings.weekStart);
}

function shiftMonth(delta) {
  calMonth0 += delta;
  if (calMonth0 < 0) {
    calMonth0 = 11;
    calYear--;
  } else if (calMonth0 > 11) {
    calMonth0 = 0;
    calYear++;
  }
  renderCalendar();
}

// 날짜별 보기 / 항목 단독·날짜 보기 적용(필터 + 캘린더 닫고 목록으로).
function viewDate(key, basis) {
  applyFilter({ kind: 'date', key, basis }, `🗓️ ${key} · ${BASIS_LABEL[basis]} 기준`);
}
function viewItemAlone(id) {
  const it = itemById(id);
  applyFilter({ kind: 'item', id }, `🔎 ${it?.label || '(제목 없음)'} · 단독`);
}

// 항목 클릭 메뉴: 단독 / 관련 조합 / 날짜 보기.
let itemMenuEl = null;
function closeItemMenu() {
  itemMenuEl?.remove();
  itemMenuEl = null;
}
function showItemMenu(id, x, y) {
  closeItemMenu();
  const it = itemById(id);
  if (!it) return;
  const menu = document.createElement('div');
  menu.className = 'item-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `${it.label || '타임카드'} 메뉴`);
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item-menu__btn';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    b.addEventListener('click', () => {
      closeItemMenu();
      fn();
    });
    return b;
  };
  menu.append(
    mk('🔎 단독 보기', () => viewItemAlone(id)),
    mk('🏷 관련 태그', () => viewRelatedGroups(id)),
    mk('🗓️ 날짜 보기', () => viewDate(dateKeyOf(it, calBasis), calBasis)),
  );
  document.body.append(menu);
  // 화면 밖으로 넘치지 않게 위치 보정
  const w = 180;
  menu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
  menu.style.top = `${y}px`;
  itemMenuEl = menu;
}
function viewRelatedGroups(id) {
  const groups = groupsForItem(loadGroups(localStorage), id);
  if (groups.length === 0) {
    srStatus.textContent = '관련 태그 없음';
    alert('이 타임카드에 지정된 태그가 없습니다.');
  } else if (groups.length === 1) {
    viewGroup(groups[0].id);
  } else {
    renderGroups(); // 여러 개면 조합 패널에서 선택
    openDrawer(groupsDrawer, groupsFab);
  }
}
// 메뉴/팝오버 밖 클릭·Esc로 닫기
document.addEventListener('click', (e) => {
  if (itemMenuEl && !e.target.closest('.item-menu')) closeItemMenu();
  if (comboPopEl && !e.target.closest('.combo-pop') && !e.target.closest('.card__groupbtn')) closeComboPopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeItemMenu();
    closeComboPopover();
  }
});

// 캘린더 그리드 클릭: 항목(미니 제목)→메뉴, 빈 날짜(항목 있는 칸)→날짜별 보기.
calGridEl.addEventListener('click', (e) => {
  const item = e.target.closest('.cal__item');
  if (item) {
    e.stopPropagation(); // 메뉴 즉시 닫힘 방지
    showItemMenu(item.dataset.id, e.clientX, e.clientY);
    return;
  }
  const day = e.target.closest('.cal__day--has');
  if (day) viewDate(day.dataset.date, calBasis);
});

onSeg(calBasisSel, (v) => {
  calBasis = v;
  renderCalendar();
});
onSeg(calWeekstartSel, (v) => {
  changeSetting({ weekStart: v });
  renderCalendar();
});
calPrevBtn.addEventListener('click', () => shiftMonth(-1));
calNextBtn.addEventListener('click', () => shiftMonth(1));
function openCalendar() {
  calYear = new Date().getFullYear();
  calMonth0 = new Date().getMonth();
  renderCalendar();
  openDrawer(calendarDrawer, calendarFab);
}
calendarFab.addEventListener('click', openCalendar);

// ── 디자인 설정: 변경 시 즉시 반영 ──
const setAddPosition = $('set-add-position');
const setProgressParts = $('set-progress-parts');
const setProgressBase = $('set-progress-base');
const setDates = $('set-dates');
const setDateFormat = $('set-date-format');
const setTheme = $('set-theme');
const setCancel = $('set-cancel');
const setOk = $('set-ok');
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
const setReset = $('set-reset');

let settings = loadSettings(localStorage);

// 세그먼트 컨트롤(드롭다운 대체): 선택값 표시(aria-pressed) + 클릭 위임.
function syncSeg(el, value) {
  for (const b of el.querySelectorAll('.seg')) b.setAttribute('aria-pressed', String(b.dataset.value === value));
}
function onSeg(el, handler) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (b) handler(b.dataset.value);
  });
}

function applySettings(s) {
  const el = document.documentElement;
  el.dataset.theme = s.theme; // 라이트/다크 팔레트 전환(나머지 색·크기는 CSS 고정)
  if (themeColorMeta) themeColorMeta.content = s.theme === 'light' ? '#eef4f0' : '#0e1512';
}

const PART_LABEL = { bar: '타임라인', pie: '도넛', percent: '퍼센트' };
// 진행률 파트 칩(바/파이/퍼센트): progressOrder 순서로 렌더, progressShow로 켜짐(aria-pressed) 표시.
function renderProgressParts(s) {
  setProgressParts.innerHTML = '';
  for (const p of s.progressOrder) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ppart';
    b.dataset.part = p;
    b.setAttribute('aria-pressed', String(!!s.progressShow[p]));
    b.textContent = PART_LABEL[p];
    setProgressParts.append(b);
  }
}

function syncSettingControls(s) {
  syncSeg(setAddPosition, s.addPosition);
  renderProgressParts(s);
  syncSeg(setProgressBase, s.progressBase);
  for (const b of setDates.querySelectorAll('.seg')) b.setAttribute('aria-pressed', String(!!s[b.dataset.key]));
  syncSeg(setDateFormat, s.dateFormat);
  syncSeg(setTheme, s.theme);
}

function changeSetting(patch) {
  settings = updateSettings(localStorage, patch);
  applySettings(settings);
  syncSettingControls(settings);
}

onSeg(setAddPosition, (v) => changeSetting({ addPosition: v }));
// 진행률 파트(바/파이/퍼센트): 탭=표시 토글, 드래그=순서 변경. 4px 임계로 탭/드래그 구분.
let ppDrag = null;
setProgressParts.addEventListener('pointerdown', (e) => {
  const chip = e.target.closest('.ppart');
  if (!chip) return;
  ppDrag = { chip, startX: e.clientX, moved: false };
  chip.setPointerCapture?.(e.pointerId);
});
setProgressParts.addEventListener('pointermove', (e) => {
  if (!ppDrag) return;
  if (!ppDrag.moved && Math.abs(e.clientX - ppDrag.startX) < 4) return;
  ppDrag.moved = true;
  ppDrag.chip.classList.add('ppart--dragging');
  const sibs = [...setProgressParts.querySelectorAll('.ppart')];
  const over = sibs.find((s) => {
    if (s === ppDrag.chip) return false;
    const r = s.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right;
  });
  if (over) {
    const r = over.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    setProgressParts.insertBefore(ppDrag.chip, after ? over.nextSibling : over);
  }
});
function endPpDrag() {
  if (!ppDrag) return;
  const { chip, moved } = ppDrag;
  chip.classList.remove('ppart--dragging');
  ppDrag = null;
  if (moved) {
    const order = [...setProgressParts.querySelectorAll('.ppart')].map((b) => b.dataset.part);
    changeSetting({ progressOrder: order });
  } else {
    const p = chip.dataset.part;
    changeSetting({ progressShow: { ...settings.progressShow, [p]: !settings.progressShow[p] } });
  }
  tick(); // 렌더 로직(updateProgress)이 읽으므로 즉시 반영
}
setProgressParts.addEventListener('pointerup', endPpDrag);
setProgressParts.addEventListener('pointercancel', endPpDrag);

onSeg(setProgressBase, (v) => {
  changeSetting({ progressBase: v });
  tick();
});
// 날짜 표시 형식(컴팩트/전체): 카드 날짜 텍스트가 바뀌므로 rebuild.
onSeg(setDateFormat, (v) => {
  changeSetting({ dateFormat: v });
  rebuild();
});
// 날짜 표시 토글(한 줄, 독립 다중): 각 칩 클릭 시 해당 키를 켜고 끔 → 카드 구조 바꾸므로 rebuild.
setDates.addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (!b) return;
  changeSetting({ [b.dataset.key]: !settings[b.dataset.key] });
  rebuild();
});
onSeg(setTheme, (v) => changeSetting({ theme: v }));
setReset.addEventListener('click', () => {
  settings = resetSettings(localStorage);
  applySettings(settings);
  syncSettingControls(settings);
  rebuild();
});

// 설정 열 때 스냅샷 → '취소'로 되돌릴 수 있게(변경은 즉시 적용되지만 취소 시 복원).
let settingsSnapshot = null;
function openSettings() {
  settingsSnapshot = { ...settings };
  openDrawer(settingsDrawer, settingsFab);
}
setOk.addEventListener('click', closeDrawer); // 확인: 변경 유지하고 닫기
setCancel.addEventListener('click', () => {
  if (settingsSnapshot) {
    settings = updateSettings(localStorage, settingsSnapshot); // 스냅샷으로 복원
    applySettings(settings);
    syncSettingControls(settings);
    rebuild();
  }
  closeDrawer();
});

// ── 드래그&드롭 재배치 (Pointer Events: 마우스+터치 공용, 모바일 대응) ──
// 데스크톱 파일 드래그처럼: 카드가 '들려' 포인터를 따라다니는 떠다니는 클론을 만들고,
// 원본은 빈 자리(placeholder)로 남아 형제들 사이를 오가며 떨어질 위치를 보여준다.
// 놓으면 클론 제거 + DOM 순서를 영속화. (이동/종료는 document에서 청취해 캡처 풀림에 안전)
let drag = null;
const DRAG_THRESHOLD = 4; // 이 거리 이상 움직여야 드래그 시작(클릭과 구분)

function beginDrag() {
  const card = drag.card;
  const rect = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  clone.classList.add('card--drag-clone');
  clone.style.width = `${rect.width}px`;
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  document.body.append(clone);
  card.classList.add('card--placeholder');
  document.body.classList.add('dragging-active');
  drag.clone = clone;
  drag.offsetX = drag.startX - rect.left;
  drag.offsetY = drag.startY - rect.top;
  drag.started = true;
}

function onDragMove(e) {
  if (!drag) return;
  if (!drag.started) {
    if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD) return;
    beginDrag();
  }
  // 떠 있는 클론을 포인터에 붙여 이동
  drag.clone.style.left = `${e.clientX - drag.offsetX}px`;
  drag.clone.style.top = `${e.clientY - drag.offsetY}px`;
  // 빈 자리(원본 카드)를 포인터 세로 위치에 맞춰 형제들 사이로 이동(단일 컬럼 기준).
  const y = e.clientY;
  const others = [...listEl.querySelectorAll('.card:not(.card--placeholder)')];
  const next = others.find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  if (next) listEl.insertBefore(drag.card, next);
  else listEl.appendChild(drag.card);
}

function onDragEnd() {
  if (!drag) return;
  const wasStarted = drag.started;
  drag.clone?.remove();
  drag.card.classList.remove('card--placeholder');
  document.body.classList.remove('dragging-active');
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);
  drag = null;
  if (wasStarted) commitOrder(); // 실제로 끌었을 때만 순서 저장
}

// 현재 DOM 카드 순서를 저장소에 반영하고 내부 상태(list/refsList)를 맞춘다.
function commitOrder() {
  const ids = [...listEl.querySelectorAll('.card')].map((c) => c.dataset.id);
  list = reorder(localStorage, ids);
  const refById = new Map(refsList.map((r) => [r.item.id, r]));
  refsList = ids.map((id) => refById.get(id)).filter(Boolean);
  srStatus.textContent = '순서 변경됨';
}

listEl.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.card__handle');
  if (!handle) return;
  if (selectMode || viewFilter) return; // 선택 모드·필터 보기에선 재배치 비활성
  const card = handle.closest('.card');
  if (!card) return;
  e.preventDefault();
  drag = { card, startX: e.clientX, startY: e.clientY, started: false, clone: null };
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {}
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
});

// ── 키보드 순서 변경(드래그의 포인터 전용 한계를 보완하는 접근성 대체수단) ──
// 핸들(≡)에 포커스한 채 ↑/↓ 한 칸, Home/End 맨 위/아래로 카드를 옮긴다.
// 순수 moveId로 새 순서를 계산 → 같은 카드 노드를 재배치하고 commitOrder로 영속화.
const KEY_DELTA = { ArrowUp: -1, ArrowDown: 1, Home: -Infinity, End: Infinity };
listEl.addEventListener('keydown', (e) => {
  const handle = e.target.closest('.card__handle');
  if (!handle || !(e.key in KEY_DELTA)) return;
  if (selectMode || viewFilter) return; // 선택 모드·필터 보기에선 재배치 비활성
  e.preventDefault();
  const id = handle.closest('.card').dataset.id;
  const ids = [...listEl.querySelectorAll('.card')].map((c) => c.dataset.id);
  const nextIds = moveId(ids, id, KEY_DELTA[e.key]);
  if (nextIds.join() === ids.join()) return; // 이미 끝 → 이동 없음
  const byId = new Map([...listEl.querySelectorAll('.card')].map((c) => [c.dataset.id, c]));
  listEl.append(...nextIds.map((x) => byId.get(x))); // 같은 노드를 새 순서로 재삽입
  commitOrder();
  handle.focus(); // 재삽입으로 풀렸을 수 있는 포커스 복구
  const pos = nextIds.indexOf(id) + 1;
  srStatus.textContent = `${itemById(id)?.label || '타임카드'} ${pos}/${nextIds.length}번째로 이동`;
});

// 초기 적용: 저장된 설정 → 화면, 컨트롤 동기화.
applySettings(settings);
syncSettingControls(settings);

setInterval(tick, 1000);
rebuild();

// PWA: 서비스 워커 등록(오프라인·설치). 실패해도 앱 동작엔 지장 없음.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
