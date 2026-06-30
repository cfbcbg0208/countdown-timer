// 0-dep dev 도구: 컬러코딩 팔레트 산출(철학: memory color-coding-philosophy / 글로벌 CLAUDE.md).
// 색 계산은 src/oklch.mjs 공유(브라우저 슬라이더와 동일 알고리즘 — 드리프트 방지).
// 출력 hex를 style.css 변수에 붙여넣음. 실행: node tools/gen-palette.mjs
import { solveOklch, roleHues, hex, toSrgb, lumOfHex } from '../src/oklch.mjs';

const ROLE_LABEL = { past: '과거 빨강', now: '현재 초록', future: '미래 파랑', origin: '등록·시작', updated: '수정', target: '기준' };
const hues = roleHues();
console.log('OKLCH hue:', Object.fromEntries(Object.entries(hues).map(([k, v]) => [k, +v.toFixed(1)])));

// 회색(무채색) at 목표 명암비: track(도넛 남은 부분 = 밴드 '남은 시간' 통일)용.
function grayAt(bgLum, target) {
  const Y = bgLum < 0.5 ? target * (bgLum + 0.05) - 0.05 : (bgLum + 0.05) / target - 0.05;
  const v = toSrgb(Math.min(1, Math.max(0, Y)));
  return hex([v, v, v]);
}

const TARGET = 7;
const TRACK_CT = 1.8; // 도넛 남은부분/밴드 '남은시간' 통일 명암비
for (const t of [
  { name: 'dark', card: '#17211c' },
  { name: 'light', card: '#ffffff' },
]) {
  const bgLum = lumOfHex(t.card);
  console.log(`\n=== ${t.name} (card ${t.card}) — 노드 ${TARGET}:1, track ${TRACK_CT}:1 ===`);
  for (const key of ['origin', 'updated', 'target', 'now', 'future', 'past']) {
    const o = solveOklch(hues[key], bgLum, TARGET);
    const varName = key === 'now' ? '--node-now' : key === 'future' ? '--future' : key === 'past' ? '--past' : `--node-${key}`;
    console.log(`  ${varName.padEnd(13)}: ${hex(o.rgb)};  /* ${ROLE_LABEL[key]} 명암비 ${o.ct.toFixed(2)}:1 */`);
  }
  const tr = grayAt(bgLum, TRACK_CT);
  console.log(`  --track      : ${tr};  /* 남은/빈 트랙(도넛·바·밴드 공통) 명암비 ${contrastOf(tr, bgLum)}:1 */`);
}
function contrastOf(hx, bgLum) {
  const l = lumOfHex(hx);
  const [hi, lo] = l > bgLum ? [l, bgLum] : [bgLum, l];
  return ((hi + 0.05) / (lo + 0.05)).toFixed(2);
}
