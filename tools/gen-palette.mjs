// 0-dep dev 도구: 컬러코딩 팔레트 산출(철학: memory color-coding-philosophy / 글로벌 CLAUDE.md).
//
// 방식(확정): 고정색 = 순수 RGB 3원색(빨강·초록·파랑). 자유색 = 그 사이를 **OKLCH(지각 균일)
//   hue 공간에서 greedy maximin**으로 균등 배치(→ 자연히 CMY 2차색). 각 테마 배경에서 (L,C)를
//   조절해 WCAG 명암비를 모두 동일(≈7:1)·채도 최대. 다크/라이트 별도.
// ※ 배경대비 동일 ⇒ 상대휘도 동일 ⇒ 색 간 WCAG 명암비 ≈1:1. 색 구분은 색조(OKLCH 균등)+채도로.
//
// 실행: node tools/gen-palette.mjs

// ── sRGB ↔ 선형 ──
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};
const relLum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b; // 선형 RGB 입력
const contrast = (l1, l2) => { const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
const hexToRgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

// ── 선형 sRGB ↔ OKLab ↔ OKLCH ──
function linToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const rgb255ToOklchHue = (rgb) => {
  const [, a, b] = linToOklab(rgb.map(toLin));
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};
// 주어진 OKLCH hue에서 목표 명암비를 내는 색 중 chroma(C) 최대인 in-gamut 해.
function solveOklch(hueDeg, bgLum, target, { tol = 0.04 } = {}) {
  const hr = (hueDeg * Math.PI) / 180, ca = Math.cos(hr), sa = Math.sin(hr);
  let best = null;
  for (let L = 0.05; L <= 1.0001; L += 0.004) {
    for (let C = 0.36; C >= 0; C -= 0.004) { // 큰 C부터 → 첫 in-gamut+명암비 일치가 최대 채도
      const lin = oklabToLin([L, C * ca, C * sa]);
      if (lin.some((v) => v < -1e-4 || v > 1 + 1e-4)) continue; // out of gamut
      const cl = lin.map((v) => Math.min(1, Math.max(0, v)));
      if (Math.abs(contrast(relLum(cl), bgLum) - target) <= tol) {
        if (!best || C > best.C) best = { rgb: cl.map(toSrgb), C, ct: contrast(relLum(cl), bgLum) };
        break; // 이 L에서 최대 C 찾음
      }
    }
  }
  return best;
}
// greedy maximin: 고정 hue들 사이 가장 큰 빈 간격의 중점에 자유 hue를 하나씩.
function placeFree(fixed, n) {
  const pts = [...fixed], free = [];
  for (let i = 0; i < n; i++) {
    const s = [...pts].sort((a, b) => a - b);
    let bestSize = -1, bestMid = 0;
    for (let j = 0; j < s.length; j++) {
      const a = s[j], b = j + 1 < s.length ? s[j + 1] : s[0] + 360;
      if (b - a > bestSize) { bestSize = b - a; bestMid = ((a + b) / 2) % 360; }
    }
    pts.push(bestMid); free.push(bestMid);
  }
  return free.sort((a, b) => a - b);
}

// 고정색 = 순수 RGB 3원색의 OKLCH hue(빨강·초록·파랑).
const HUE_RED = rgb255ToOklchHue([255, 0, 0]);
const HUE_GREEN = rgb255ToOklchHue([0, 255, 0]);
const HUE_BLUE = rgb255ToOklchHue([0, 0, 255]);
const freeHues = placeFree([HUE_RED, HUE_GREEN, HUE_BLUE], 3); // → ~노랑/청록/마젠타
console.log(`고정 OKLCH hue: 빨강 ${HUE_RED.toFixed(1)}° · 초록 ${HUE_GREEN.toFixed(1)}° · 파랑 ${HUE_BLUE.toFixed(1)}°`);
console.log(`자유 OKLCH hue(maximin): ${freeHues.map((h) => h.toFixed(1) + '°').join(' / ')}  (등록/수정/기준)`);

const TARGET = 7;
const ROLES = [
  { key: '--past       ', label: '과거 빨강 ', hue: HUE_RED },
  { key: '--node-now   ', label: '현재 초록 ', hue: HUE_GREEN },
  { key: '--future     ', label: '미래 파랑 ', hue: HUE_BLUE },
  { key: '--node-origin', label: '등록·시작 ', hue: freeHues[0] },
  { key: '--node-updated', label: '수정     ', hue: freeHues[1] },
  { key: '--node-target', label: '기준     ', hue: freeHues[2] },
];
for (const t of [
  { name: 'dark ', card: '#17211c' },
  { name: 'light', card: '#ffffff' },
]) {
  const bgLum = relLum(hexToRgb(t.card).map(toLin));
  console.log(`\n=== ${t.name.trim()} (card ${t.card}, bgLum=${bgLum.toFixed(4)}) ===`);
  const lums = [];
  for (const r of ROLES) {
    const o = solveOklch(r.hue, bgLum, TARGET);
    lums.push(relLum(o.rgb.map(toLin)));
    console.log(`  ${r.key}: ${hex(o.rgb)};  /* ${r.label} OKLCH ${r.hue.toFixed(0)}° 명암비 ${o.ct.toFixed(2)}:1 C=${o.C.toFixed(3)} */`);
  }
  // future-dim: 파랑 hue, 낮은 명암비(흐린 남은시간)
  const dim = solveOklch(HUE_BLUE, bgLum, 2.5);
  console.log(`  --future-dim : ${hex(dim.rgb)};  /* 남은시간 흐린파랑 명암비 ${dim.ct.toFixed(2)}:1 */`);
  let inter = 9;
  for (let i = 0; i < lums.length; i++) for (let j = i + 1; j < lums.length; j++) inter = Math.min(inter, contrast(lums[i], lums[j]));
  console.log(`  → 코딩색 간 WCAG 명암비(min) ≈ ${inter.toFixed(2)}:1 (동일 휘도라 ~1, 구분은 색조로)`);
}
