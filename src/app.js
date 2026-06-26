// 여러 카운트다운을 목록으로 관리(추가·삭제·영속·드래그 수동정렬·동시 틱).
// 렌더 전략: 데이터 변경 시에만 DOM을 (재)구성하고, 매초엔 각 카드의 시간/색만 갱신한다.
// 추가 영역은 우하단 FAB로 열리는 드로어(오버레이)에 들어 있다.
import {
  parseFlexible,
  diff,
  formatDuration,
  formatLocal,
  elapsedFraction,
  monthGrid,
  dateKeyOf,
} from './time.js';
import {
  load,
  add,
  remove,
  reorder,
  updateItem,
  moveId,
  loadGroups,
  addGroup,
  removeGroup,
  removeItemFromGroups,
  groupsForItem,
  toggleItemInGroup,
  setItemGroups,
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
const pickerInput = $('picker-input');
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
const addGroupsEl = $('add-groups');

// 추가 드로어에서 새 카드가 들어갈 조합 id들(생성 시 적용).
let pendingGroupIds = new Set();

// 보기 필터: null=전체 | {kind:'group',id} | {kind:'date',key,basis} | {kind:'item',id}.
// (조합 보기·캘린더 날짜 보기·항목 단독 보기를 하나의 필터로 통합)
let viewFilter = null;
let selectMode = false;
const selectedIds = new Set();
const BASIS_LABEL = { target: '기준일시', created: '등록일시', updated: '수정일시' };

// 부호는 D-Day 관례: 남은=− (D-7), 지난=+ (D+3). 색은 부호와 별개(남은=초록/지난=빨강).
const DIRS = {
  future: { label: '남은 시간', chip: '남은시간', emoji: '⏳', sign: '−', cls: 'display--future' },
  past: { label: '지난 시간', chip: '지난시간', emoji: '⌛', sign: '+', cls: 'display--past' },
  now: { label: '바로 지금!', chip: '지금', emoji: '🎯', sign: '', cls: '' },
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
    val.textContent = formatLocal(new Date(iso));
    row.append(val, chip(label));
  }
  return row;
}

// 카드 1장 DOM 생성(텍스트는 textContent로 넣어 자동 이스케이프).
function makeCard(item) {
  const card = document.createElement('article');
  card.className = 'card';
  card.dataset.id = item.id;

  const handle = document.createElement('button');
  handle.className = 'card__handle';
  handle.type = 'button';
  handle.title = '드래그 또는 ↑/↓ 키로 순서 변경';
  handle.setAttribute(
    'aria-label',
    `${item.label || '타임카드'} 순서 변경. 드래그하거나 화살표 위/아래, Home/End 키 사용`,
  );
  handle.textContent = '≡';
  card.append(handle);

  const del = document.createElement('button');
  del.className = 'card__del';
  del.type = 'button';
  del.dataset.id = item.id;
  del.title = '삭제';
  del.setAttribute('aria-label', `${item.label || '타임카드'} 삭제`);
  del.textContent = '✕';
  card.append(del);

  // 제목: 클릭하면 그 자리에서 바로 수정. 비어 있으면 '＋ 제목' 안내. 제목 있으면 [제목] 칩.
  const labelEl = document.createElement('button');
  labelEl.type = 'button';
  labelEl.className = 'card__label' + (item.label ? '' : ' card__label--empty');
  labelEl.title = '클릭하여 제목 수정';
  labelEl.setAttribute('aria-label', `제목 수정: ${item.label || '없음'}`);
  labelEl.textContent = item.label || '＋ 제목';
  if (item.label) labelEl.append(chip('제목'));
  card.append(labelEl);

  // 시간 행: [시간 + 방향 칩](좌측)  …  [기록](우측, 큰 숫자 줄의 빈 공간 활용).
  const timeEl = document.createElement('div');
  timeEl.className = 'card__time';
  const lapEl = document.createElement('button');
  lapEl.className = 'card__lap';
  lapEl.type = 'button';
  lapEl.dataset.id = item.id;
  lapEl.title = '지금 이 순간의 값을 기록(랩)';
  lapEl.setAttribute('aria-label', `${item.label || '타임카드'} 현재 값 기록`);
  lapEl.textContent = '기록'; // 빨간 핀(📍) 제거 → CSS로 녹색 점
  const timeRow = document.createElement('div');
  timeRow.className = 'card__row card__row--time';
  timeRow.append(timeEl, lapEl);

  // 진행률(미래 카드만): '둘 다'면 파이 → 바 순서. 클릭하면 진행 시작 일시 지정.
  const progressEl = document.createElement('div');
  progressEl.className = 'card__progress';
  progressEl.title = '클릭하여 진행 시작 일시 지정';
  const pieEl = document.createElement('div');
  pieEl.className = 'card__pie';
  const barEl = document.createElement('div');
  barEl.className = 'card__bar';
  const barFillEl = document.createElement('div');
  barFillEl.className = 'card__bar-fill';
  barEl.append(barFillEl);
  progressEl.append(pieEl, barEl);

  // 기준일시 행(클릭 편집, 토글). 값 + [기준일시] 칩은 updateCard가 갱신.
  const metaEl = document.createElement('button');
  metaEl.type = 'button';
  metaEl.className = 'card__meta';
  metaEl.title = '클릭하여 기준일시 수정';
  const targetRow = document.createElement('div');
  targetRow.className = 'card__row card__row--date';
  targetRow.hidden = !settings.showTarget;
  targetRow.append(metaEl);

  // 등록/수정 일시 행(설정 토글). 라벨은 모두 네 글자로 통일.
  const createdRow = dateRow('등록일시', item.createdAt, settings.showCreated);
  const updatedRow = dateRow('수정일시', item.updatedAt, settings.showUpdated);

  // 조합(그룹) 칩 줄: 이 카드가 속한 조합 + '＋ 조합' 버튼(생성/편집에서 직접 추가).
  const groupsRow = document.createElement('div');
  groupsRow.className = 'card__groups';
  card.append(timeRow, progressEl, targetRow, createdRow, updatedRow, groupsRow);
  fillCardGroups(groupsRow, item.id);

  const lapsEl = document.createElement('ul');
  lapsEl.className = 'card__laps';
  card.append(lapsEl);

  const refs = { card, timeEl, progressEl, barFillEl, pieEl, metaEl, lapsEl, item, dir: null };
  renderLaps(refs);
  updateCard(refs);
  return refs;
}

// 기록(랩) 목록 렌더: 각 랩은 '기록 당시의 상대값 + 기록 시각'. 기준일시·기록시각 모두
// 불변이라 값이 변하지 않으므로 매초 갱신(updateCard) 대신 데이터 변경 시에만 그린다.
function renderLaps(refs) {
  const target = new Date(refs.item.targetISO);
  const laps = Array.isArray(refs.item.laps) ? refs.item.laps : [];
  refs.lapsEl.hidden = laps.length === 0;
  refs.lapsEl.replaceChildren(
    ...laps.map((iso, i) => {
      const at = new Date(iso);
      const r = diff(target, at);
      const d = DIRS[r.direction];
      const li = document.createElement('li');
      li.className = 'lap';
      const val = document.createElement('span');
      val.className = 'lap__val';
      val.textContent = (d.sign || '') + formatDuration(r);
      const when = document.createElement('span');
      when.className = 'lap__when';
      when.textContent = `기록 ${formatLocal(at)}`;
      const del = document.createElement('button');
      del.className = 'lap__del';
      del.type = 'button';
      del.dataset.id = refs.item.id;
      del.dataset.index = String(i);
      del.title = '기록 삭제';
      del.setAttribute('aria-label', '기록 삭제');
      del.textContent = '✕';
      li.append(val, when, del);
      return li;
    }),
  );
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
    (d.sign ? `<span class="display__sign">${d.sign}</span>` : '') +
    formatDuration(r) +
    ` <span class="chip chip--${r.direction}">${d.chip}</span>`;
  // 기준일시: 값(좌측) + [기준일시] 칩. (formatLocal 출력은 숫자·하이픈·요일뿐이라 innerHTML에 안전)
  refs.metaEl.innerHTML = `${formatLocal(target)} <span class="chip">기준일시</span>`;
  updateProgress(refs, item, target, r.direction);
  refs.dir = r.direction;
}

// 진행률(미래 카드만): 설정 스타일/기준에 따라 바·파이 갱신. 과거/없음이면 숨김.
function updateProgress(refs, item, target, direction) {
  const style = settings.progressStyle;
  if (direction !== 'future' || style === 'none') {
    refs.progressEl.hidden = true;
    return;
  }
  const start =
    item.startISO || (settings.progressBase === 'updated' ? item.updatedAt : item.createdAt) || item.createdAt;
  const f = elapsedFraction(start, target);
  const pct = (f * 100).toFixed(1);
  refs.progressEl.hidden = false;
  refs.progressEl.dataset.style = style; // CSS로 바/파이/둘다 표시 제어
  refs.barFillEl.style.width = `${pct}%`;
  refs.pieEl.style.background = `conic-gradient(var(--future) ${pct}%, var(--track) 0)`;
  refs.progressEl.setAttribute('aria-label', `진행률 ${Math.round(f * 100)}%`);
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
  emptyHint.hidden = shown.length > 0 || !!viewFilter;
  refsList = shown.map(makeCard);
  listEl.replaceChildren(...refsList.map((r) => r.card));
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
    textPreview.textContent = '❌ 인식할 수 없는 형식입니다.';
    return;
  }
  const r = diff(d);
  const dir = DIRS[r.direction];
  // 해석된 기준일시까지/부터 남은·지난 양도 함께(방향 라벨 우측 빈 공간 활용).
  const amount = r.direction === 'now' ? '' : `  ·  ${formatDuration(r)}`;
  textPreview.className = 'zone__preview preview--ok';
  textPreview.textContent = `✅ ${formatLocal(d)}  ·  ${dir.emoji} ${dir.label}${amount}`;
}

function addFrom(source) {
  const raw = (source === 'text' ? textInput.value : pickerInput.value).trim();
  const date = parseFlexible(raw);
  if (!date) {
    if (source === 'text') {
      textPreview.className = 'zone__preview preview--err';
      textPreview.textContent = '❌ 인식할 수 없는 형식입니다.';
    } else {
      alert('달력에서 시각을 먼저 선택하세요.');
    }
    return;
  }
  // 제목을 비우면 기준일시와 같은 서식(formatLocal)으로 자동 제목 생성.
  const labelText = labelInput.value.trim() || formatLocal(date);
  const item = add(localStorage, { label: labelText, targetISO: toLocalISO(date) });
  if (pendingGroupIds.size) setItemGroups(localStorage, item.id, [...pendingGroupIds]); // 생성 시 조합 지정
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
textInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  // 비어 있으면 1번째 Enter: 현재 시각(컴팩트)으로 채우고 커서는 기준일시 끝에 유지.
  if (textInput.value.trim() === '') {
    textInput.value = compactNow();
    updatePreview();
    const end = textInput.value.length;
    textInput.setSelectionRange(end, end);
    return;
  }
  // 채워져 있고 유효하면 다음 Enter: 제목으로 이동. 무효면 오류 표시(이동 안 함).
  if (parseFlexible(textInput.value.trim())) labelInput.focus();
  else updatePreview();
});
labelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addFrom('text');
  }
});
document.querySelectorAll('.zone__apply').forEach((btn) => {
  btn.addEventListener('click', () => addFrom(btn.dataset.source));
});
function itemById(id) {
  return list.find((t) => t.id === id);
}

// 랩(스냅샷) 기록: 기준일시는 건드리지 않고 '지금 이 순간'을 목록에 남긴다(최신 먼저).
function addLap(id) {
  const item = itemById(id);
  if (!item) return;
  const laps = [new Date().toISOString(), ...(Array.isArray(item.laps) ? item.laps : [])];
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

// ── 인라인 필드 편집: 제목/기준일시를 클릭하면 그 자리(필드 바로 아래)에 입력창이 열린다 ──
// field: 'title'(텍스트) | 'date'(자유 텍스트→해석). 한 카드에 하나만. 같은 필드 재클릭 시 닫힘(토글).
function openFieldEditor(card, id, field) {
  const existing = card.querySelector('.card__editor');
  if (existing) {
    const sameField = existing.dataset.field === field;
    existing.remove(); // 다른 필드면 닫고 새로, 같은 필드면 토글로 닫기만
    if (sameField) return;
  }
  const item = itemById(id);
  if (!item) return;
  const editor = document.createElement('div');
  editor.className = 'card__editor';
  editor.dataset.field = field;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'card__editinput';
  input.autocomplete = 'off';
  if (field === 'date') {
    // 기준일시도 추가영역처럼 '자유 텍스트 → 해석' 방식. 현재값을 파싱 가능한 형태로 채운다.
    input.value = toLocalISO(new Date(item.targetISO)).replace('T', ' ');
    input.placeholder = '예: 260626금1800 · 2026-06-26 18:00 · 오후 6시';
    input.spellcheck = false;
  } else if (field === 'start') {
    // 진행률 0% 기준을 이 카드만 따로 지정(비우면 설정 기본=등록/수정일시).
    input.value = item.startISO ? toLocalISO(new Date(item.startISO)).replace('T', ' ') : '';
    input.placeholder = '진행 시작 일시 · 비우면 기본(등록/수정일시)';
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
  editor.append(input, save, cancel);

  // 기준일시/시작: 입력하는 동안 해석 결과를 라이브 미리보기로 보여준다.
  if (field === 'date' || field === 'start') {
    const preview = document.createElement('p');
    preview.className = 'card__editpreview';
    editor.append(preview);
    const refresh = () => {
      input.removeAttribute('aria-invalid');
      const raw = input.value.trim();
      if (!raw) {
        preview.textContent = field === 'start' ? '기본값(등록/수정일시) 사용' : '';
        delete preview.dataset.ok;
        return;
      }
      const d = parseFlexible(raw);
      if (!d) {
        preview.textContent = '❌ 인식할 수 없는 형식';
        preview.dataset.ok = 'no';
        return;
      }
      const dir = DIRS[diff(d).direction];
      preview.textContent =
        field === 'start' ? `✅ ${formatLocal(d)}` : `✅ ${formatLocal(d)} · ${dir.emoji} ${dir.label}`;
      preview.dataset.ok = 'yes';
    };
    input.addEventListener('input', refresh);
    refresh();
  }

  // 클릭한 필드(또는 그 필드가 속한 행) 바로 아래에 삽입(행 내부에 넣으면 레이아웃 깨짐).
  const ANCHOR = { date: '.card__meta', start: '.card__progress', title: '.card__label' };
  const anchor = card.querySelector(ANCHOR[field]);
  (anchor.closest('.card__row') || anchor).after(editor);
  input.focus();
  input.select?.();
}

function commitField(card, id, field) {
  const input = card.querySelector('.card__editor .card__editinput');
  if (!input) return;
  if (field === 'date') {
    const date = parseFlexible(input.value);
    if (!date) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    list = updateItem(localStorage, id, { targetISO: toLocalISO(date) });
    srStatus.textContent = '기준일시 변경됨';
  } else if (field === 'start') {
    const raw = input.value.trim();
    if (raw === '') {
      list = updateItem(localStorage, id, { startISO: null }); // 비우면 기본값으로
      srStatus.textContent = '진행 시작 기본값으로';
    } else {
      const date = parseFlexible(raw);
      if (!date) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      list = updateItem(localStorage, id, { startISO: toLocalISO(date) });
      srStatus.textContent = '진행 시작 변경됨';
    }
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
  } else if (lapDel) {
    removeLap(id, +lapDel.dataset.index);
  } else if (e.target.closest('.card__lap')) {
    addLap(id);
  } else if (e.target.closest('.card__save')) {
    commitField(card, id, card.querySelector('.card__editor')?.dataset.field);
  } else if (e.target.closest('.card__cancel')) {
    card.querySelector('.card__editor')?.remove();
  } else if (e.target.closest('.card__label')) {
    openFieldEditor(card, id, 'title');
  } else if (e.target.closest('.card__meta')) {
    openFieldEditor(card, id, 'date');
  } else if (e.target.closest('.card__progress')) {
    openFieldEditor(card, id, 'start'); // 진행률 바/파이 클릭 → 진행 시작 일시 지정
  } else if (e.target.closest('.card__group')) {
    viewGroup(e.target.closest('.card__group').dataset.gid); // 소속 조합 칩 → 그 조합 보기
  } else if (e.target.closest('.card__groupbtn')) {
    openComboPopover(e.target.closest('.card__groupbtn'), id); // ＋조합 → 토글 팝오버
  }
});

// 추가 드로어 열기: 조합 선택 초기화 + 조합 선택기 렌더 후 연다.
function openAddDrawer() {
  pendingGroupIds = new Set();
  renderComboChooser(addGroupsEl, {
    isOn: (gid) => pendingGroupIds.has(gid),
    toggle: (gid) => (pendingGroupIds.has(gid) ? pendingGroupIds.delete(gid) : pendingGroupIds.add(gid)),
    onCreate: (name) => pendingGroupIds.add(addGroup(localStorage, { name, itemIds: [] }).id),
  });
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
    if (selectMode) exitSelectMode();
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
  } else if (e.code === 'KeyG') {
    e.preventDefault();
    renderGroups();
    openDrawer(groupsDrawer, groupsFab);
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
      const name = document.createElement('span');
      name.className = 'group__name';
      name.textContent = g.name || '(이름 없음)';
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
      del.title = '조합 삭제';
      del.setAttribute('aria-label', `${g.name || '조합'} 삭제`);
      del.textContent = '✕';
      li.append(name, count, view, del);
      return li;
    }),
  );
}

function viewGroup(id) {
  const g = loadGroups(localStorage).find((x) => x.id === id);
  if (!g) return;
  applyFilter({ kind: 'group', id }, `🗂️ ${g.name || '조합'} · ${(g.itemIds || []).length}개`);
}

// ── 카드↔조합: 카드에 소속 조합 칩 표시 + '＋ 조합'으로 재생목록식 추가/제거 ──
// 카드의 .card__groups 칸을 (소속 조합 칩들 + ＋버튼)으로 다시 채운다.
function fillCardGroups(container, id) {
  const groups = groupsForItem(loadGroups(localStorage), id);
  const chips = groups.map((g) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card__group';
    b.dataset.gid = g.id;
    b.textContent = g.name || '조합';
    b.title = `조합 "${g.name || ''}" 보기`;
    return b;
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'card__groupbtn';
  addBtn.dataset.id = id;
  addBtn.title = '이 카드를 조합에 추가/제거';
  addBtn.setAttribute('aria-label', '조합에 추가 또는 제거');
  addBtn.textContent = groups.length ? '＋' : '＋ 조합';
  container.replaceChildren(...chips, addBtn);
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
    p.textContent = '저장된 조합이 없습니다. 아래에서 새로 만들어 보세요.';
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
      nm.textContent = g.name || '조합';
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
  input.placeholder = '새 조합 이름';
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

// 카드의 '＋ 조합' 버튼 옆에 뜨는 작은 팝오버(재생목록식 토글).
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
  pop.setAttribute('aria-label', '조합에 추가/제거');
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
  const name = groupNameInput.value.trim() || `조합 (${selectedIds.size}개)`;
  addGroup(localStorage, { name, itemIds: [...selectedIds] });
  srStatus.textContent = `조합 "${name}" 저장됨`;
  exitSelectMode();
}

groupsNewBtn.addEventListener('click', enterSelectMode);
groupsListEl.addEventListener('click', (e) => {
  const view = e.target.closest('.group__view');
  const del = e.target.closest('.group__del');
  if (view) viewGroup(view.dataset.id);
  else if (del) {
    removeGroup(localStorage, del.dataset.id);
    if (viewFilter?.kind === 'group' && viewFilter.id === del.dataset.id) clearViewFilter();
    renderGroups();
    rebuild(); // 카드의 소속 조합 칩 갱신
    srStatus.textContent = '조합 삭제됨';
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
    mk('🗂️ 관련 조합', () => viewRelatedGroups(id)),
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
    srStatus.textContent = '관련 조합 없음';
    alert('이 타임카드가 속한 조합이 없습니다.');
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
const setProgressStyle = $('set-progress-style');
const setProgressBase = $('set-progress-base');
const setDates = $('set-dates');
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

function syncSettingControls(s) {
  syncSeg(setAddPosition, s.addPosition);
  syncSeg(setProgressStyle, s.progressStyle);
  syncSeg(setProgressBase, s.progressBase);
  for (const b of setDates.querySelectorAll('.seg')) b.setAttribute('aria-pressed', String(!!s[b.dataset.key]));
  syncSeg(setTheme, s.theme);
}

function changeSetting(patch) {
  settings = updateSettings(localStorage, patch);
  applySettings(settings);
  syncSettingControls(settings);
}

onSeg(setAddPosition, (v) => changeSetting({ addPosition: v }));
// 진행률 설정은 렌더 로직(updateCard)이 읽으므로, 변경 즉시 tick으로 카드에 반영.
onSeg(setProgressStyle, (v) => {
  changeSetting({ progressStyle: v });
  tick();
});
onSeg(setProgressBase, (v) => {
  changeSetting({ progressBase: v });
  tick();
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
  // 빈 자리(원본 카드)를 포인터에 가장 가까운 카드 앞/뒤로 이동(다열 그리드 2D 대응).
  // 같은 행이면 좌우(x), 다른 행이면 상하(y)로 앞/뒤를 정한다.
  const x = e.clientX, y = e.clientY;
  const others = [...listEl.querySelectorAll('.card:not(.card--placeholder)')];
  let best = null, bestDist = Infinity;
  for (const c of others) {
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  if (best) {
    const r = best.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const after = Math.abs(y - cy) <= r.height / 2 ? x > cx : y > cy;
    if (after) best.after(drag.card);
    else best.before(drag.card);
  } else {
    listEl.appendChild(drag.card);
  }
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
