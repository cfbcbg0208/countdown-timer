// M2: 목표 1개를 입력받아 1초마다 남은/경과 시간을 표시한다.
import { parseTarget, diff, formatDuration } from './time.js';

const form = document.getElementById('target-form');
const input = document.getElementById('target-input');
const display = document.getElementById('display');
const labelEl = document.getElementById('display-label');
const timeEl = document.getElementById('display-time');
const targetEl = document.getElementById('display-target');

let targetDate = null;
let timer = null;

const LABELS = { future: '남은 시간', past: '지난 시간', now: '지금' };

function render() {
  if (!targetDate) return;
  const r = diff(targetDate);
  labelEl.textContent = LABELS[r.direction];
  timeEl.textContent = formatDuration(r);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const d = parseTarget(input.value);
  if (!d) {
    alert('시각을 인식할 수 없습니다.');
    return;
  }
  targetDate = d;
  targetEl.textContent = '목표: ' + d.toLocaleString();
  display.hidden = false;
  render();
  if (timer) clearInterval(timer);
  timer = setInterval(render, 1000);
});
