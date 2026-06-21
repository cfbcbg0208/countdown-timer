// 여러 카운트다운을 목록으로 관리(추가·삭제·영속·임박순 정렬·동시 틱).
// 렌더 전략: 데이터 변경 시에만 DOM을 (재)구성하고, 매초엔 각 카드의 시간/색만 갱신한다.
import { parseFlexible, diff, formatDuration, formatLocal } from './time.js';
import { load, add, remove, sortByUrgency } from './store.js';

const $ = (id) => document.getElementById(id);
const labelInput = $('label-input');
const textInput = $('text-input');
const textPreview = $('text-preview');
const pickerInput = $('picker-input');
const listEl = $('list');
const emptyHint = $('empty-hint');
const srStatus = $('sr-status');

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

  const refs = { card, timeEl, metaEl, item, dir: null };
  updateCard(refs);
  return refs;
}

// 카드의 시간/색/메타만 갱신(DOM 구조는 그대로).
function updateCard(refs) {
  const target = new Date(refs.item.targetISO);
  const r = diff(target);
  const d = DIRS[r.direction];
  refs.card.className = `card ${d.cls}`.trim();
  refs.timeEl.innerHTML =
    (d.sign ? `<span class="display__sign">${d.sign}</span>` : '') + formatDuration(r);
  refs.metaEl.textContent = `${d.emoji} ${d.label} · 목표 ${formatLocal(target)}`;
  refs.dir = r.direction;
}

// 데이터 변경 시: 정렬 후 목록 DOM 재구성.
function rebuild() {
  const sorted = sortByUrgency(list);
  emptyHint.hidden = sorted.length > 0;
  refsList = sorted.map(makeCard);
  listEl.replaceChildren(...refsList.map((r) => r.card));
}

// 매초: 각 카드 시간만 갱신. 미래↔과거 경계를 넘은 카드가 있으면 재정렬.
function tick() {
  let crossed = false;
  for (const r of refsList) {
    const before = r.dir;
    updateCard(r);
    if (before && before !== r.dir) crossed = true;
  }
  if (crossed) rebuild();
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
  srStatus.textContent = `${labelText || '카운트다운'} 추가됨`;
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
listEl.addEventListener('click', (e) => {
  const del = e.target.closest('.card__del');
  if (del) {
    list = remove(localStorage, del.dataset.id);
    rebuild();
    srStatus.textContent = '카운트다운 삭제됨';
  }
});

setInterval(tick, 1000);
rebuild();

// PWA: 서비스 워커 등록(오프라인·설치). 실패해도 앱 동작엔 지장 없음.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
