// 여러 카운트다운을 목록으로 관리(추가·삭제·영속·드래그 수동정렬·동시 틱).
// 렌더 전략: 데이터 변경 시에만 DOM을 (재)구성하고, 매초엔 각 카드의 시간/색만 갱신한다.
// 추가 영역은 우하단 FAB로 열리는 드로어(오버레이)에 들어 있다.
import { parseFlexible, diff, formatDuration, formatLocal, elapsedFraction } from './time.js';
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
} from './store.js';
import {
  load as loadSettings,
  update as updateSettings,
  reset as resetSettings,
  ACCENTS,
  DENSITY,
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

// 조합(그룹) 상태: 필터 보기 중인 그룹 id, 다중 선택 모드 + 선택된 카드 id 집합.
let activeGroupId = null;
let selectMode = false;
const selectedIds = new Set();

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
    `${item.label || '카운트다운'} 순서 변경. 드래그하거나 화살표 위/아래, Home/End 키 사용`,
  );
  handle.textContent = '≡';
  card.append(handle);

  const del = document.createElement('button');
  del.className = 'card__del';
  del.type = 'button';
  del.dataset.id = item.id;
  del.title = '삭제';
  del.setAttribute('aria-label', `${item.label || '카운트다운'} 삭제`);
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

  // 시간 + 방향 칩(남은시간/지난시간): updateCard가 매초 갱신.
  const timeEl = document.createElement('div');
  timeEl.className = 'card__time';

  // 진행률(미래 카드만): '둘 다'면 파이 → 바 순서.
  const progressEl = document.createElement('div');
  progressEl.className = 'card__progress';
  const pieEl = document.createElement('div');
  pieEl.className = 'card__pie';
  const barEl = document.createElement('div');
  barEl.className = 'card__bar';
  const barFillEl = document.createElement('div');
  barFillEl.className = 'card__bar-fill';
  barEl.append(barFillEl);
  progressEl.append(pieEl, barEl);

  // 기준일시 행: [값 + 기준일시 칩](클릭 편집)  …  [📍 기록](우측, 한 줄 공유로 공간 절약).
  const metaEl = document.createElement('button');
  metaEl.type = 'button';
  metaEl.className = 'card__meta';
  metaEl.title = '클릭하여 기준일시 수정';
  const lapEl = document.createElement('button');
  lapEl.className = 'card__lap';
  lapEl.type = 'button';
  lapEl.dataset.id = item.id;
  lapEl.title = '지금 이 순간의 값을 기록(랩)';
  lapEl.setAttribute('aria-label', `${item.label || '카운트다운'} 현재 값 기록`);
  lapEl.textContent = '📍 기록';
  const metaRow = document.createElement('div');
  metaRow.className = 'card__row card__row--meta';
  metaRow.append(metaEl, lapEl);

  // 등록/수정 일시 행(설정 토글).
  const createdRow = dateRow('등록', item.createdAt, settings.showCreated);
  const updatedRow = dateRow('수정', item.updatedAt, settings.showUpdated);

  card.append(timeEl, progressEl, metaRow, createdRow, updatedRow);

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
  refs.pieEl.style.background = `conic-gradient(var(--accent) ${pct}%, var(--track) 0)`;
  refs.progressEl.setAttribute('aria-label', `진행률 ${Math.round(f * 100)}%`);
}

// 데이터 변경 시: 저장된(수동) 순서 그대로 목록 DOM 재구성.
// 조합 필터(activeGroupId)가 있으면 그 그룹 멤버만 보여준다.
function rebuild() {
  let shown = list;
  if (activeGroupId) {
    const g = loadGroups(localStorage).find((x) => x.id === activeGroupId);
    if (g) shown = list.filter((t) => g.itemIds.includes(t.id));
    else activeGroupId = null; // 그룹이 사라졌으면 필터 해제
  }
  emptyHint.hidden = shown.length > 0 || !!activeGroupId;
  refsList = shown.map(makeCard);
  listEl.replaceChildren(...refsList.map((r) => r.card));
  if (selectMode) {
    for (const r of refsList) r.card.classList.toggle('card--selected', selectedIds.has(r.item.id));
  }
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
  const dir = DIRS[diff(d).direction];
  textPreview.className = 'zone__preview preview--ok';
  textPreview.textContent = `✅ ${formatLocal(d)}  ·  ${dir.emoji} ${dir.label}`;
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
  // 조합 필터 보기 중이었다면 해제해 새 카드가 보이게.
  activeGroupId = null;
  groupBanner.hidden = true;
  rebuild();
  closeDrawer();
  srStatus.textContent = `${labelText || '카운트다운'} 추가됨`;
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

  // 기준일시: 입력하는 동안 해석 결과를 라이브 미리보기로 보여준다(추가영역과 동일 컨셉).
  if (field === 'date') {
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
        preview.textContent = '❌ 인식할 수 없는 형식';
        preview.dataset.ok = 'no';
        return;
      }
      const dir = DIRS[diff(d).direction];
      preview.textContent = `✅ ${formatLocal(d)} · ${dir.emoji} ${dir.label}`;
      preview.dataset.ok = 'yes';
    };
    input.addEventListener('input', refresh);
    refresh();
  }

  // 클릭한 필드(또는 그 필드가 속한 행) 바로 아래에 삽입(행 내부에 넣으면 레이아웃 깨짐).
  const anchor = field === 'date' ? card.querySelector('.card__meta') : card.querySelector('.card__label');
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
    srStatus.textContent = '카운트다운 삭제됨';
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
  }
});

// 드로어 열기/닫기 (추가 ＋ / 설정 ⚙️)
fab.addEventListener('click', () => openDrawer(drawer, fab, textInput));
settingsFab.addEventListener('click', () => openDrawer(settingsDrawer, settingsFab));
groupsFab.addEventListener('click', () => {
  renderGroups();
  openDrawer(groupsDrawer, groupsFab);
});
[drawer, settingsDrawer, groupsDrawer].forEach((d) => {
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
    openDrawer(drawer, fab, textInput);
  } else if (e.code === 'KeyS') {
    e.preventDefault();
    openDrawer(settingsDrawer, settingsFab);
  } else if (e.code === 'KeyG') {
    e.preventDefault();
    renderGroups();
    openDrawer(groupsDrawer, groupsFab);
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
  activeGroupId = id;
  groupBanner.hidden = false;
  groupBannerName.textContent = `🗂️ ${g.name || '조합'} · ${(g.itemIds || []).length}개`;
  closeDrawer();
  rebuild();
}

function clearGroupView() {
  activeGroupId = null;
  groupBanner.hidden = true;
  rebuild();
}

function enterSelectMode() {
  selectMode = true;
  selectedIds.clear();
  activeGroupId = null; // 전체 카드에서 선택하도록 필터 해제
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
    if (activeGroupId === del.dataset.id) clearGroupView();
    renderGroups();
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
groupBannerClear.addEventListener('click', clearGroupView);

// ── 디자인 설정: 저장 → CSS 변수/제목 표시에 즉시 반영 ──
const setTimerScale = $('set-timer-scale');
const setMetaScale = $('set-meta-scale');
const setLapScale = $('set-lap-scale');
const setDensity = $('set-density');
const setAddPosition = $('set-add-position');
const setProgressStyle = $('set-progress-style');
const setProgressBase = $('set-progress-base');
const setShowCreated = $('set-show-created');
const setShowUpdated = $('set-show-updated');
const accentBox = $('set-accent');
const setReset = $('set-reset');

let settings = loadSettings(localStorage);

function applySettings(s) {
  const root = document.documentElement.style;
  root.setProperty('--card-time-size', (1.9 * s.timerScale).toFixed(3) + 'rem');
  root.setProperty('--card-meta-size', (0.8 * s.metaScale).toFixed(3) + 'rem');
  root.setProperty('--card-lap-size', (0.8 * s.lapScale).toFixed(3) + 'rem');
  root.setProperty('--accent', ACCENTS[s.accent]);
  root.setProperty('--list-gap', DENSITY[s.density]);
}

function syncSettingControls(s) {
  setTimerScale.value = s.timerScale;
  setMetaScale.value = s.metaScale;
  setLapScale.value = s.lapScale;
  setDensity.value = s.density;
  setAddPosition.value = s.addPosition;
  setProgressStyle.value = s.progressStyle;
  setProgressBase.value = s.progressBase;
  setShowCreated.checked = s.showCreated;
  setShowUpdated.checked = s.showUpdated;
  for (const b of accentBox.children) {
    b.setAttribute('aria-pressed', String(b.dataset.accent === s.accent));
  }
}

// 강조색 스와치 동적 생성(프리셋 키마다 원형 버튼).
for (const key of Object.keys(ACCENTS)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.dataset.accent = key;
  b.style.background = ACCENTS[key];
  b.setAttribute('aria-label', `강조색 ${key}`);
  b.setAttribute('aria-pressed', 'false');
  accentBox.append(b);
}

function changeSetting(patch) {
  settings = updateSettings(localStorage, patch);
  applySettings(settings);
  syncSettingControls(settings);
}

setTimerScale.addEventListener('input', () => changeSetting({ timerScale: +setTimerScale.value }));
setMetaScale.addEventListener('input', () => changeSetting({ metaScale: +setMetaScale.value }));
setLapScale.addEventListener('input', () => changeSetting({ lapScale: +setLapScale.value }));
setDensity.addEventListener('change', () => changeSetting({ density: setDensity.value }));
setAddPosition.addEventListener('change', () => changeSetting({ addPosition: setAddPosition.value }));
// 진행률 설정은 렌더 로직(updateCard)이 읽으므로, 변경 즉시 tick으로 카드에 반영.
setProgressStyle.addEventListener('change', () => {
  changeSetting({ progressStyle: setProgressStyle.value });
  tick();
});
setProgressBase.addEventListener('change', () => {
  changeSetting({ progressBase: setProgressBase.value });
  tick();
});
// 등록/수정 일시 표시 토글은 카드 구조(행 hidden)를 바꾸므로 rebuild로 반영.
setShowCreated.addEventListener('change', () => {
  changeSetting({ showCreated: setShowCreated.checked });
  rebuild();
});
setShowUpdated.addEventListener('change', () => {
  changeSetting({ showUpdated: setShowUpdated.checked });
  rebuild();
});
accentBox.addEventListener('click', (e) => {
  const b = e.target.closest('.swatch');
  if (b) changeSetting({ accent: b.dataset.accent });
});
setReset.addEventListener('click', () => {
  settings = resetSettings(localStorage);
  applySettings(settings);
  syncSettingControls(settings);
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
  // 빈 자리(원본 카드)를 포인터 세로 위치에 맞춰 형제들 사이로 이동
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
  if (selectMode || activeGroupId) return; // 선택 모드·조합 필터 보기에선 재배치 비활성
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
  if (selectMode || activeGroupId) return; // 선택 모드·조합 필터 보기에선 재배치 비활성
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
  srStatus.textContent = `${itemById(id)?.label || '카운트다운'} ${pos}/${nextIds.length}번째로 이동`;
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
