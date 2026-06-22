// 여러 카운트다운을 목록으로 관리(추가·삭제·영속·드래그 수동정렬·동시 틱).
// 렌더 전략: 데이터 변경 시에만 DOM을 (재)구성하고, 매초엔 각 카드의 시간/색만 갱신한다.
// 추가 영역은 우하단 FAB로 열리는 드로어(오버레이)에 들어 있다.
import { parseFlexible, diff, formatDuration, formatLocal } from './time.js';
import { load, add, remove, reorder, updateItem } from './store.js';
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
  handle.title = '드래그하여 순서 변경';
  handle.setAttribute('aria-label', `${item.label || '카운트다운'} 순서 변경(드래그)`);
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

  const pauseEl = document.createElement('button');
  pauseEl.className = 'card__pause';
  pauseEl.type = 'button';
  pauseEl.dataset.id = item.id;
  card.append(pauseEl);

  const refs = { card, timeEl, metaEl, pauseEl, item, dir: null };
  updateCard(refs);
  return refs;
}

// 카드의 시간/색/메타만 갱신(DOM 구조는 그대로).
// 일시정지 상태면 '현재' 대신 정지 시점(pausedAt) 기준으로 계산해 값을 얼린다.
function updateCard(refs) {
  const item = refs.item;
  const target = new Date(item.targetISO);
  const at = item.paused && item.pausedAt ? new Date(item.pausedAt) : new Date();
  const r = diff(target, at);
  const d = DIRS[r.direction];
  // className 통째로 덮어쓰면 드래그 중(card--dragging) 클래스가 지워지므로 toggle 사용.
  refs.card.classList.toggle('display--future', r.direction === 'future');
  refs.card.classList.toggle('display--past', r.direction === 'past');
  refs.card.classList.toggle('card--paused', !!item.paused);
  refs.timeEl.innerHTML =
    (d.sign ? `<span class="display__sign">${d.sign}</span>` : '') + formatDuration(r);
  const pausedTag = item.paused ? '⏸ 정지됨 · ' : '';
  refs.metaEl.textContent = `${pausedTag}${d.emoji} ${d.label} · 목표 ${formatLocal(target)}`;
  refs.pauseEl.textContent = item.paused ? '▶ 재개' : '⏸ 일시정지';
  refs.pauseEl.setAttribute('aria-pressed', String(!!item.paused));
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

// 일시정지 ↔ 재개 (키친타이머식): 정지 동안 카운트가 멈추고, 재개 시 멈춰 있던
// 만큼 목표시각을 뒤로 밀어 남은/지난 값이 끊김 없이 이어지게 한다.
function togglePause(id) {
  const item = itemById(id);
  if (!item) return;
  if (item.paused) {
    const pausedMs = new Date(item.pausedAt).getTime();
    const shift = Number.isNaN(pausedMs) ? 0 : Date.now() - pausedMs;
    const newTarget = new Date(new Date(item.targetISO).getTime() + shift);
    list = updateItem(localStorage, id, {
      paused: false,
      pausedAt: null,
      targetISO: toLocalISO(newTarget),
    });
    srStatus.textContent = '재개됨';
  } else {
    list = updateItem(localStorage, id, { paused: true, pausedAt: new Date().toISOString() });
    srStatus.textContent = '일시정지됨';
  }
  rebuild();
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
  // 끝시간을 바꾸면 정지 기준이 무의미해지므로 일시정지는 해제.
  list = updateItem(localStorage, id, {
    targetISO: toLocalISO(date),
    paused: false,
    pausedAt: null,
  });
  rebuild();
  srStatus.textContent = '끝시간 변경됨';
}

listEl.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.closest('.card__del')) {
    list = remove(localStorage, id);
    rebuild();
    srStatus.textContent = '카운트다운 삭제됨';
  } else if (e.target.closest('.card__pause')) {
    togglePause(id);
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
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
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
// 핸들에서 시작 → 포인터를 따라 카드 사이에 끼워 넣고, 놓으면 DOM 순서를 영속화.
let drag = null;

function onDragMove(e) {
  if (!drag) return;
  const y = e.clientY;
  const others = [...listEl.querySelectorAll('.card:not(.card--dragging)')];
  // 포인터 세로 위치가 중점보다 위인 첫 카드 '앞'에 삽입, 없으면 맨 끝.
  const next = others.find((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  if (next) listEl.insertBefore(drag.card, next);
  else listEl.appendChild(drag.card);
}

function onDragEnd() {
  if (!drag) return;
  const { card } = drag;
  document.removeEventListener('pointermove', onDragMove);
  document.removeEventListener('pointerup', onDragEnd);
  document.removeEventListener('pointercancel', onDragEnd);
  card.classList.remove('card--dragging');
  drag = null;
  commitOrder();
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
  drag = { card };
  card.classList.add('card--dragging');
  // 이동/종료는 document에서 듣는다: 카드가 DOM에서 옮겨져도(insertBefore) 포인터
  // 캡처가 풀려 이벤트가 끊기는 문제를 피한다. (setPointerCapture는 터치 보조용)
  try {
    handle.setPointerCapture(e.pointerId);
  } catch {}
  document.addEventListener('pointermove', onDragMove);
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);
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
