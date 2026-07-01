// 0-dep dev 도구: WCAG 단일 알고리즘 팔레트 산출. 색 계산은 src/oklch.mjs 공유. 실행: node tools/gen-palette.mjs
// 조건5=배경과 같은 WCAG 명암비, 조건6=색간 ΔE 최대, 조건7=Range A[Min A,Max A]·기본=Max A.
import { solveWcagPalette, wcagColor, rangeA, minPairwiseDE, roleHues, hex, hexToRgb, toLin, relLum } from '../src/oklch.mjs';

const ROLE_ORDER = ['past', 'now', 'future', 'origin', 'updated', 'start', 'target'];
const ROLE_VAR   = { past: '--past', now: '--node-now', future: '--future', origin: '--node-origin', updated: '--node-updated', start: '--node-start', target: '--node-target' };
const hues = roleHues();
const hueArr = ROLE_ORDER.map((k) => hues[k]);

for (const t of [{ name: 'dark', card: '#17211c' }, { name: 'light', card: '#ffffff' }]) {
  const bgLum = relLum(hexToRgb(t.card).map(toLin));
  const { minA, maxA } = rangeA(hueArr, t.card);
  const pal = solveWcagPalette(hueArr, t.card, maxA);
  console.log(`\n###### ${t.name} (card ${t.card}) — Range A [${minA.toFixed(2)}, ${maxA.toFixed(2)}] 기본 ${maxA.toFixed(2)}:1, 색간 최소 ΔE ${minPairwiseDE(pal).toFixed(3)} ######`);
  pal.forEach((p, i) => console.log(`  ${ROLE_VAR[ROLE_ORDER[i]].padEnd(16)}: ${hex(p.rgb)};  /* WCAG ${p.w.toFixed(2)} */`));
  console.log(`  --remain        : ${hex(wcagColor(hues.future, bgLum, 2.0).rgb)};  /* 잔량 WCAG 2.0 */`);
}
