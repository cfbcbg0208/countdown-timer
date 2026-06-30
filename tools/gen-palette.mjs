// 0-dep dev 도구: 컬러코딩 팔레트 산출(철학: memory color-coding-philosophy / 글로벌 CLAUDE.md).
// 색 계산은 src/oklch.mjs 공유(브라우저 슬라이더와 동일 알고리즘 — 드리프트 방지).
// 출력 hex를 style.css 변수에 붙여넣음. 실행: node tools/gen-palette.mjs
import { solveOklch, roleHues, hex, lumOfHex } from '../src/oklch.mjs';

const ROLE_LABEL = { past: '과거 빨강', now: '현재 초록', future: '미래 파랑', origin: '등록·시작', updated: '수정', target: '기준' };
const hues = roleHues();
console.log('OKLCH hue:', Object.fromEntries(Object.entries(hues).map(([k, v]) => [k, +v.toFixed(1)])));

const TARGET = 7;
const REMAIN_CT = 2.5; // 미래 '남은시간 잔량'(파랑) 기본 명암비 — 빈 트랙(과거)과 구분·더 진하게
for (const t of [
  { name: 'dark', card: '#17211c' },
  { name: 'light', card: '#ffffff' },
]) {
  const bgLum = lumOfHex(t.card);
  console.log(`\n=== ${t.name} (card ${t.card}) — 노드 ${TARGET}:1, remain ${REMAIN_CT}:1 ===`);
  for (const key of ['origin', 'updated', 'target', 'now', 'future', 'past']) {
    const o = solveOklch(hues[key], bgLum, TARGET);
    const varName = key === 'now' ? '--node-now' : key === 'future' ? '--future' : key === 'past' ? '--past' : `--node-${key}`;
    console.log(`  ${varName.padEnd(13)}: ${hex(o.rgb)};  /* ${ROLE_LABEL[key]} 명암비 ${o.ct.toFixed(2)}:1 */`);
  }
  // 미래 남은시간 잔량 = 파랑(future hue) at REMAIN_CT. (과거 빈 영역 --track은 은은한 회색 별도.)
  const rm = solveOklch(hues.future, bgLum, REMAIN_CT);
  console.log(`  --remain     : ${hex(rm.rgb)};  /* 남은시간 잔량(파랑) 명암비 ${rm.ct.toFixed(2)}:1 */`);
}
