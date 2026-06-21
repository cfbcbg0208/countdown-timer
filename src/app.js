// M4b: 여러 카운트다운을 목록으로 관리(추가·삭제·영속·임박순 정렬·동시 틱).
import { parseFlexible, diff, formatDuration, formatLocal } from './time.js';
import { load, add, remove, sortByUrgency } from './store.js';

const $ = (id) => document.getElementById(id);
const labelInput = $('label-input');
const textInput = $('text-input');
const textPreview = $('text-preview');
const pickerInput = $('picker-input');
const listEl = $('list');
const emptyHint = $('empty-hint');

// 부호는 D-Day 관례: 남은=− (D-7), 지난=+ (D+3). 색은 부호와 별개(남은=초록/지난=빨강).
const DIRS = {
  future: { label: '남은 시간', emoji: '⏳', sign: '−', cls: 'display--future' },
  past: { label: '지난 시간', emoji: '⌛', sign: '+', cls: 'display--past' },
  now: { label: '바로 지금!', emoji: '🎯', sign: '', cls: '' },
};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// 로컬 시각을 보존하는 ISO 문자열(오프셋 없이 → new Date()가 로컬로 되읽음).
function toLocalISO(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

let list = load(localStorage);

function cardHTML(item) {
  const target = new Date(item.targetISO);
  const r = diff(target);
  const d = DIRS[r.direction];
  const sign = d.sign ? `<span class="display__sign">${d.sign}</span>` : '';
  const label = item.label ? `<span class="card__label">${esc(item.label)}</span>` : '';
  return `<article class="card ${d.cls}">
    <button class="card__del" data-id="${esc(item.id)}" title="삭제" aria-label="삭제">✕</button>
    ${label}
    <div class="card__time">${sign}${formatDuration(r)}</div>
    <div class="card__meta">${d.emoji} ${d.label} · 목표 ${formatLocal(target)}</div>
  </article>`;
}

function render() {
  const sorted = sortByUrgency(list);
  emptyHint.hidden = sorted.length > 0;
  listEl.innerHTML = sorted.map(cardHTML).join('');
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
  add(localStorage, { label: labelInput.value.trim(), targetISO: toLocalISO(date) });
  list = load(localStorage);
  labelInput.value = '';
  if (source === 'text') {
    textInput.value = '';
    updatePreview();
  }
  render();
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
    render();
  }
});

setInterval(render, 1000);
render();

// PWA: 서비스 워커 등록(오프라인·설치). 실패해도 앱 동작엔 지장 없음.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
