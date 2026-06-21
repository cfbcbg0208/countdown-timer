// M3b: 두 입력 구역(텍스트/선택기), 텍스트 실시간 해석 미리보기,
// 활성 방식 표시, +/- 부호·색상·이모지 방향 표시.
import { parseFlexible, diff, formatDuration, formatLocal } from './time.js';

const $ = (id) => document.getElementById(id);

const textInput = $('text-input');
const textPreview = $('text-preview');
const pickerInput = $('picker-input');
const zones = { text: $('zone-text'), picker: $('zone-picker') };

const display = $('display');
const labelEl = $('display-label');
const timeEl = $('display-time');
const targetEl = $('display-target');
const emptyHint = $('empty-hint');

// 방향별 표시 메타: 라벨 · 이모지 · 부호 · CSS 클래스
const DIRS = {
  future: { label: '남은 시간', emoji: '⏳', sign: '+', cls: 'display--future' },
  past: { label: '지난 시간', emoji: '⌛', sign: '−', cls: 'display--past' },
  now: { label: '바로 지금!', emoji: '🎯', sign: '', cls: '' },
};

let target = null; // 현재 적용된 목표 Date
let source = null; // 'text' | 'picker'
let timer = null;

function render() {
  if (!target) return;
  const r = diff(target);
  const d = DIRS[r.direction];
  display.className = `display ${d.cls}`.trim();
  labelEl.textContent = `${d.emoji} ${d.label}`;
  timeEl.innerHTML = d.sign
    ? `<span class="display__sign">${d.sign}</span>${formatDuration(r)}`
    : formatDuration(r);
  targetEl.textContent = `목표: ${formatLocal(target)}`;
}

function setActiveZone() {
  for (const [name, el] of Object.entries(zones)) {
    el.classList.toggle('zone--active', name === source);
  }
}

function applyTarget(date, src) {
  target = date;
  source = src;
  setActiveZone();
  display.hidden = false;
  emptyHint.hidden = true;
  render();
  if (timer) clearInterval(timer);
  timer = setInterval(render, 1000);
}

// 텍스트 입력: 타이핑할 때마다 해석 결과를 미리 보여준다(적용은 버튼/Enter).
function updateTextPreview() {
  const raw = textInput.value.trim();
  if (raw === '') {
    textPreview.className = 'zone__preview preview--idle';
    textPreview.textContent = '형식을 입력하면 해석 결과가 여기 표시됩니다.';
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
  textPreview.className = 'zone__preview preview--ok';
  textPreview.textContent = `✅ ${formatLocal(d)}  ·  ${dir.emoji} ${dir.label}`;
}

function applyFromText() {
  const d = parseFlexible(textInput.value.trim());
  if (!d) {
    textPreview.className = 'zone__preview preview--err';
    textPreview.textContent = '❌ 인식할 수 없는 형식입니다.';
    return;
  }
  applyTarget(d, 'text');
}

function applyFromPicker() {
  const d = parseFlexible(pickerInput.value.trim());
  if (!d) {
    alert('달력에서 시각을 먼저 선택하세요.');
    return;
  }
  applyTarget(d, 'picker');
}

// 이벤트 배선
textInput.addEventListener('input', updateTextPreview);
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyFromText();
  }
});
document.querySelectorAll('.zone__apply').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.source === 'text') applyFromText();
    else applyFromPicker();
  });
});
