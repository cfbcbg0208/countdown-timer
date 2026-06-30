// 컬러코딩 색 계산(0-dep, ES 모듈). Node 생성기(tools/gen-palette.mjs)와 브라우저(app.js) 공용.
// 단일 알고리즘(2026-07-01 사용자 결정 — WCAG 단일로 정리, ΔE-only 모드 폐기):
//   조건 1·2: 고정색 = sRGB 원색(빨/녹/파)의 OKLCH hue. 과거=빨강, 현재=초록, 미래=파랑.
//   조건 3: 자유색 = 고정 hue 기반 maximin으로 360° 안에 최대한 고르게 분포.
//   조건 4·5: 라이트/다크 배경 각각에 대해, 모든 색이 배경과 '같은 WCAG 명암비'(등 명암비)가 되게.
//   조건 6: 그 위에서 색끼리 가장 약한 쌍(min pairwise OKLab ΔE)을 최대화.
//   조건 7: Range A = 조건 6이 정점 부근으로 유지되는 명암비 구간 [Min A, Max A]. 기본값 = Max A.
//   조건 8: 슬라이더는 1:1~21:1 전체. Range A 밖이면 조건 5+사용자 명암비만 만족(조건 6은 그 안에서 최대).
// 지표: OKLab ΔE = √(ΔL²+Δa²+Δb²). 철학: memory color-coding-philosophy / 글로벌 CLAUDE.md.

// ── sRGB ↔ 선형 ──
export const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const toSrgb = (c) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};
export const relLum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b; // 선형 RGB 입력
export const contrast = (l1, l2) => { const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };
export const hexToRgb = (h) => { h = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
export const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
export const lumOfHex = (h) => relLum(hexToRgb(h).map(toLin));

// ── 선형 sRGB ↔ OKLab ──
export function linToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function oklabToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
export const rgb255ToOklchHue = (rgb) => {
  const [, a, b] = linToOklab(rgb.map(toLin));
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};
// 순수 RGB 3원색의 OKLCH hue(빨/녹/파).
export const FIXED_HUES = { red: rgb255ToOklchHue([255, 0, 0]), green: rgb255ToOklchHue([0, 255, 0]), blue: rgb255ToOklchHue([0, 0, 255]) };

// greedy maximin: 고정 hue들 사이 가장 큰 빈 간격의 중점에 자유 hue를 하나씩 배치.
export function placeFree(fixed, n) {
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

// 역할별 OKLCH hue(고정 빨/녹/파 + 자유 등록/수정/기준 = maximin).
export function roleHues() {
  const free = placeFree([FIXED_HUES.red, FIXED_HUES.green, FIXED_HUES.blue], 3);
  return { past: FIXED_HUES.red, now: FIXED_HUES.green, future: FIXED_HUES.blue, origin: free[0], updated: free[1], target: free[2] };
}

// ── OKLab ΔE (조건 6 지표) ──
// OKLab 유클리드 색차.
export function deltaE([L1, a1, b1], [L2, a2, b2]) {
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}
// 조건 6 값: 가장 약한 색쌍의 ΔE(min pairwise). 클수록 색끼리 잘 구분됨.
export function minPairwiseDE(pal) {
  let m = Infinity;
  for (let i = 0; i < pal.length; i++) for (let j = i + 1; j < pal.length; j++) m = Math.min(m, deltaE(pal[i].lab, pal[j].lab));
  return m;
}

// ── 조건 5: 등 WCAG 명암비 팔레트 ──
// 고정 hue에서 배경 대비 WCAG 명암비 = targetC인 '최대 채도' 색(OKLab L 이분탐색으로 명암비 일치).
// 모든 색이 같은 WCAG 명암비 = 배경에서 똑같이 도드라짐(조건 5). 등 WCAG ⇒ 휘도 동일 ⇒
// '휘도 맞춘 L의 최대 채도'가 회색축에서 가장 멀어 색쌍 ΔE도 최대(= 조건 6 동시 달성).
export function wcagColor(hueDeg, bgLum, targetC) {
  const hr = (hueDeg * Math.PI) / 180, ca = Math.cos(hr), sa = Math.sin(hr);
  const inGamut = (lin) => lin.every((v) => v >= -0.0008 && v <= 1.0008);
  const maxCAt = (L) => { let lo = 0, hi = 0.4; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (inGamut(oklabToLin([L, m * ca, m * sa]))) lo = m; else hi = m; } return lo; };
  const colorAt = (L) => {
    const C = maxCAt(L);
    const rgb = oklabToLin([L, C * ca, C * sa]).map((v) => toSrgb(Math.max(0, Math.min(1, v))));
    return { rgb, C, lab: [L, C * ca, C * sa], w: contrast(relLum(rgb.map(toLin)), bgLum) };
  };
  const dir = bgLum < 0.5 ? 1 : -1; // 다크: L↑→명암비↑ / 라이트: L↑→명암비↓
  let lo = 0.04, hi = 0.985;
  for (let i = 0; i < 30; i++) { const L = (lo + hi) / 2; if ((colorAt(L).w < targetC) === (dir > 0)) lo = L; else hi = L; }
  return colorAt((lo + hi) / 2);
}
export function solveWcagPalette(huesArr, bgHex, targetC) {
  const bgLum = relLum(hexToRgb(bgHex).map(toLin));
  return huesArr.map((h) => wcagColor(h, bgLum, targetC));
}
// 배경 대비 도달 가능한 최대 WCAG 명암비(흰/검 방향). 살짝 안쪽.
export const wcagMaxC = (bgLum) => contrast(bgLum < 0.5 ? 1 : 0, bgLum) * 0.985;

// 조건 8: 명암비 슬라이더 범위(WCAG :1). Range A(다크 [4.1,4.9]·라이트 [3.4,4.1]) 주변으로 좁혀
// 밴드가 잘 보이게 3.0~7.0(2026-07-01 사용자 지정 — 1~21은 Range A가 점선처럼 좁아 보임).
export const SLIDER_MIN = 3, SLIDER_MAX = 7;

// 조건 7: Range A = 조건 6(색간 min ΔE)이 정점의 tol배 이상 유지되는 명암비 구간 [minA, maxA].
//   이 구간 안에서는 조건 5·6 + 사용자 명암비가 모두 성립. 벗어나면(명암비를 더 올리거나 내리면)
//   색이 흰/검 한 점으로 뭉쳐 조건 6이 붕괴 → 조건 5+사용자 명암비만 만족(조건 6은 그 안에서 최대).
//   기본값(시작값) = maxA: 조건 5·6을 유지하며 배경에서 가장 멀리 떨어진 권장 명암비.
export function rangeA(huesArr, bgHex, tol = 0.95, step = 0.1) {
  const bgLum = relLum(hexToRgb(bgHex).map(toLin));
  const cmax = wcagMaxC(bgLum);
  const curve = [];
  for (let C = 1.5; C <= cmax; C += step) {
    const pal = solveWcagPalette(huesArr, bgHex, C);
    if (!pal.every((p) => Math.abs(p.w - C) < 0.25)) break; // 도달 불가하면 중단
    curve.push({ C, q: minPairwiseDE(pal) });
  }
  if (!curve.length) return { minA: 1.5, maxA: 4.5 };
  const qmax = Math.max(...curve.map((c) => c.q));
  const band = curve.filter((c) => c.q >= qmax * tol);
  return { minA: band[0].C, maxA: band[band.length - 1].C };
}
