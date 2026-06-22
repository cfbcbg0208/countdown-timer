// 여러 카운트다운을 목록으로 관리(추가·삭제·영속·드래그 수동정렬·동시 틱).
// 렌더 전략: 데이터 변경 시에만 DOM을 (재)구성하고, 매초엔 각 카드의 시간/색만 갱신한다.
// 추가 영역은 우하단 FAB로 열리는 드로어(오버레이)에 들어 있다.
import { parseFlexible, diff, formatDuration, formatLocal } from './time.js';
import { load, add, remove, reorder, updateItem, moveId } from './store.js';
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
const appTitle = $('app-title');
const fab = $('fab');
const drawer = $('drawer');
const settingsFab = $('settings-fab');
const settingsDrawer = $('settings-drawer');

// 부호는 D-Day 관례: 남은=− (D-7), 지난=+ (D+3). 색은 부호와 별개(남은=초록/지난=빨강).
const DIRS = {
  future: { label: '남은 시간', emoji: '⏳', sign: '−', cls: 'display--future' },
  past: { label: '지난 시간', emoji: '⌛', sign: '+', cls: 'display--past' },
  now: { label: '바로 지금!', emoji: '🎯', sign: '', cls: '' },
};

// 로컬 시각을 보존하는 ISO 문자열(오프셋 없이 → new Date()가 로컬로 되읽음).
function toLocalISO(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

let list = load(localStorage);
let refsList = []; // 화면에 그려진 카드들의 참조 { card, timeEl, metaEl, item, dir }

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

  const edit = document.createElement('button');
  edit.className = 'card__edit';
  edit.type = 'button';
  edit.dataset.id = item.id;
  edit.title = '끝시간 수정';
  edit.setAttribute('aria-label', `${item.label || '카운트다운'} 끝시간 수정`);
  edit.textContent = '✎';
  card.append(edit);

  const del = document.createElement('button');
  del.className = 'card__del';
  del.type = 'button';
  del.dataset.id = item.id;
  del.title = '삭제';
  del.setAttribute('aria-label', `${item.label || '카운트다운'} 삭제`);
  del.textContent = '✕';
  card.append(del);

  if (item.label) {
    const labelEl = document.createElement('span');
    labelEl.className = 'card__label';
    labelEl.textContent = item.label;
    card.append(labelEl);
  }

  const timeEl = document.createElement('div');
  timeEl.className = 'card__time';
  const metaEl = document.createElement('div');
  metaEl.className = 'card__meta';
  card.append(timeEl, metaEl);

  // 랩(스냅샷): 기준일시는 절대 불변. 지금 이 순간의 값을 '기록'으로 남긴다.
  const lapEl = document.createElement('button');
  lapEl.className = 'card__lap';
  lapEl.type = 'button';
  lapEl.dataset.id = item.id;
  lapEl.title = '지금 이 순간의 값을 기록(랩)';
  lapEl.setAttribute('aria-label', `${item.label || '카운트다운'} 현재 값 기록`);
  lapEl.textContent = '📍 기록';
  card.append(lapEl);

  const lapsEl = document.createElement('ul');
  lapsEl.className = 'card__laps';
  card.append(lapsEl);

  const refs = { card, timeEl, metaEl, lapsEl, item, dir: null };
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
  refs.timeEl.innerHTML =
    (d.sign ? `<span class="display__sign">${d.sign}</span>` : '') + formatDuration(r);
  // '남은 시간/지난 시간' 라벨은 제거(부호·색이 방향을 이미 표현). 이모지+기준일시만.
  refs.metaEl.textContent = `${d.emoji} 기준일시 ${formatLocal(target)}`;
  refs.dir = r.direction;
}

// 데이터 변경 시: 저장된(수동) 순서 그대로 목록 DOM 재구성.
function rebuild() {
  emptyHint.hidden = list.length > 0;
  refsList = list.map(makeCard);
  listEl.replaceChildren(...refsList.map((r) => r.card));
}

// 매초: 각 카드 시간/색만 갱신. 수동 순서이므로 경계 넘어도 재정렬하지 않음.
function tick() {
  for (const r of refsList) updateCard(r);
}

function updatePreview() {
  const raw = textInput.value.trim();
  if (raw === '') {
    textPreview.className = 'zone__preview preview--idle';
    textPreview.textContent = '형식을 입력하면 해석 결과가 표시됩니다.';
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
  const labelText = labelInput.value.trim();
  add(localStorage, { label: labelText, targetISO: toLocalISO(date) });
  list = load(localStorage);
  labelInput.value = '';
  if (source === 'text') {
    textInput.value = '';
    updatePreview();
  }
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
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

// 이벤트 배선
textInput.addEventListener('input', updatePreview);
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addFrom('text');
  }
});
labelInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    textInput.focus();
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

// 끝시간 인라인 에디터 열기/닫기/저장.
function openEditor(card, id) {
  if (card.querySelector('.card__editor')) return;
  const item = itemById(id);
  if (!item) return;
  const editor = document.createElement('div');
  editor.className = 'card__editor';
  const input = document.createElement('input');
  input.type = 'datetime-local';
  input.step = '1';
  input.className = 'card__editinput';
  input.value = toLocalISO(new Date(item.targetISO));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(card, id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeEditor(card);
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
  card.append(editor);
  input.focus();
}

function closeEditor(card) {
  card.querySelector('.card__editor')?.remove();
}

function commitEdit(card, id) {
  const input = card.querySelector('.card__editinput');
  if (!input) return;
  const date = parseFlexible(input.value);
  if (!date) {
    input.setAttribute('aria-invalid', 'true');
    return;
  }
  list = updateItem(localStorage, id, { targetISO: toLocalISO(date) });
  rebuild();
  srStatus.textContent = '끝시간 변경됨';
}

listEl.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const lapDel = e.target.closest('.lap__del');
  if (e.target.closest('.card__del')) {
    list = remove(localStorage, id);
    rebuild();
    srStatus.textContent = '카운트다운 삭제됨';
  } else if (lapDel) {
    removeLap(id, +lapDel.dataset.index);
  } else if (e.target.closest('.card__lap')) {
    addLap(id);
  } else if (e.target.closest('.card__edit')) {
    openEditor(card, id);
  } else if (e.target.closest('.card__save')) {
    commitEdit(card, id);
  } else if (e.target.closest('.card__cancel')) {
    closeEditor(card);
  }
});

// 드로어 열기/닫기 (추가 ＋ / 설정 ⚙️)
fab.addEventListener('click', () => openDrawer(drawer, fab, labelInput));
settingsFab.addEventListener('click', () => openDrawer(settingsDrawer, settingsFab));
[drawer, settingsDrawer].forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeDrawer();
  });
});
// 전역 단축키: Esc는 항상 닫기. '+'/'='로 추가 드로어, ','로 설정 드로어 열기.
// 단, 입력칸에 타이핑 중이거나 이미 드로어가 열려 있거나 수정자키와 함께면 무시(오작동 방지).
function isTyping(el) {
  return (
    el &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    return;
  }
  if (openEl || isTyping(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    openDrawer(drawer, fab, labelInput);
  } else if (e.key === ',') {
    e.preventDefault();
    openDrawer(settingsDrawer, settingsFab);
  }
});

// ── 디자인 설정: 저장 → CSS 변수/제목 표시에 즉시 반영 ──
const setTitleShown = $('set-title-shown');
const setTitleScale = $('set-title-scale');
const setTimerScale = $('set-timer-scale');
const setDensity = $('set-density');
const accentBox = $('set-accent');
const setReset = $('set-reset');

let settings = loadSettings(localStorage);

function applySettings(s) {
  const root = document.documentElement.style;
  appTitle.hidden = !s.titleShown;
  root.setProperty('--title-size', (1.35 * s.titleScale).toFixed(3) + 'rem');
  root.setProperty('--card-time-size', (1.9 * s.timerScale).toFixed(3) + 'rem');
  root.setProperty('--accent', ACCENTS[s.accent]);
  root.setProperty('--list-gap', DENSITY[s.density]);
}

function syncSettingControls(s) {
  setTitleShown.checked = s.titleShown;
  setTitleScale.value = s.titleScale;
  setTimerScale.value = s.timerScale;
  setDensity.value = s.density;
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

setTitleShown.addEventListener('change', () => changeSetting({ titleShown: setTitleShown.checked }));
setTitleScale.addEventListener('input', () => changeSetting({ titleScale: +setTitleScale.value }));
setTimerScale.addEventListener('input', () => changeSetting({ timerScale: +setTimerScale.value }));
setDensity.addEventListener('change', () => changeSetting({ density: setDensity.value }));
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
