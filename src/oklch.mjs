// 컬러코딩 색 계산(0-dep, ES 모듈). Node 생성기(tools/gen-palette.mjs)와 브라우저(app.js) 공용.
// 단일 알고리즘(2026-07-01 사용자 결정 — WCAG 단일로 정리, ΔE-only 모드 폐기):
//   조건 1·2: 고정색 = sRGB 원색(빨/녹/파)의 OKLCH hue. 과거=빨강, 현재=초록, 미래=파랑.
//   조건 3: 자유색 = 고정 hue 기반 maximin으로 360° 안에 최대한 고르게 분포.
//   조건 4·5: 라이트/다크 배경 각각에 대해, 모든 색이 배경과 '같은 WCAG 명암비'(등 명암비)가 되게.
//   조건 6: 그 위에서 색끼리 가장 약한 쌍(min pairwise OKLab ΔE)을 최대화.
//   조건 7: Range A = 조건 6이 정점 부근으로 유지되는 명암비 구간 [Min A, Max A]. 기본값 = Max A.
//   조건 8: 슬라이더는 3:1~7:1(사용자 스펙 step5). Range A 밖이면 조건 5+사용자 명암비만 만족(조건 6은 그 안에서 최대).
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
// HSL(h°, S100%, L50%) → sRGB[0-255]. 색 이름이 HSL 관례와 일치(빨=0·초=120·파=240·노랑=60·청록=180…).
export function hslToRgb255(h) {
  h = ((h % 360) + 360) % 360;
  const x = 1 - Math.abs(((h / 60) % 2) - 1);
  const [r, g, b] =
    h < 60 ? [1, x, 0] : h < 120 ? [x, 1, 0] : h < 180 ? [0, 1, x] : h < 240 ? [0, x, 1] : h < 300 ? [x, 0, 1] : [1, 0, x];
  return [r, g, b].map((v) => Math.round(v * 255));
}
// HSL hue → 그 HSL 색(S100·L50)의 OKLCH hue. **hue 분포는 HSL 기준(사용자 스펙), 색 계산만 OKLCH.**
export const hslHueToOklch = (h) => rgb255ToOklchHue(hslToRgb255(h));
// 고정 hue = HSL 0/120/240(빨/초/파, 균등 120° — 사용자 스펙 'HSL Hue 0/120/240'). 자유색은 이 위에서 균등 분포.
export const FIXED_HUES = { red: 0, green: 120, blue: 240 };

// 전역(global) maximin: 자유 hue n개를 '전부 새로' 배치해 모든 색(고정+자유)의 최소 hue 간격을 최대화.
// 방법: 고정 hue 사이 호(arc)들에 점을 하나씩 배분하되, 매번 '현재 가장 큰 하위 호'(width/(k+1))를 가진
//   호에 넣는다 → 원 위 고정점 사이 점 배치의 최소-하위호 최대화(전역 최적). 각 호는 넣은 점 수로 균등 분할.
// ⚠️ 증분(greedy-incremental)이 아니라, N이 바뀌면 자유 hue 전체가 이 규칙으로 매번 새로 계산된다
//    (기존 자유색을 고정한 채 하나만 끼워넣지 않음 — 사용자 스펙 1).
export function placeFree(fixed, n) {
  const f = [...fixed].sort((a, b) => a - b);
  const arcs = f.map((h, i) => ({ start: h, width: (i + 1 < f.length ? f[i + 1] : f[0] + 360) - h, k: 0 }));
  for (let i = 0; i < n; i++) {
    let best = 0;
    // 동점(같은 하위호)일 때는 뒤쪽(높은 hue) 호를 택한다(>=): 사용자 예시가 파랑↔빨강 호에 2점([60,180,280,320]).
    for (let j = 1; j < arcs.length; j++)
      if (arcs[j].width / (arcs[j].k + 1) >= arcs[best].width / (arcs[best].k + 1)) best = j;
    arcs[best].k++;
  }
  const free = [];
  for (const a of arcs) for (let i = 0; i < a.k; i++) free.push((a.start + (a.width * (i + 1)) / (a.k + 1)) % 360);
  return free.sort((a, b) => a - b);
}

// 역할별 HSL hue(고정 빨0/초120/파240 + 자유 = HSL에서 전역 maximin). 색 계산은 wcagColor가 OKLCH로 변환.
// 자유색 4개. N=4 전역해 = [60, 180, 280, 320] (파랑240↔빨강360 호에 2점 균등). N 변동 시 전부 재계산됨.
// 배정(사용자 예시): 60=등록, 180=수정, 280=기준, 320=시작.
export function roleHues() {
  const free = placeFree([FIXED_HUES.red, FIXED_HUES.green, FIXED_HUES.blue], 4);
  return { past: FIXED_HUES.red, now: FIXED_HUES.green, future: FIXED_HUES.blue, origin: free[0], updated: free[1], target: free[2], start: free[3] };
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
// **입력 hue는 HSL(사용자 스펙)** → 내부에서 OKLCH hue로 변환해 색을 계산.
// 그 hue에서 배경 대비 WCAG 명암비 = targetC인 '최대 채도' 색(OKLab L 이분탐색으로 명암비 일치).
// 모든 색이 같은 WCAG 명암비 = 배경에서 똑같이 도드라짐(조건 5). 등 WCAG ⇒ 휘도 동일 ⇒
// '휘도 맞춘 L의 최대 채도'가 회색축에서 가장 멀어 색쌍 ΔE도 최대(= 조건 6 동시 달성).
export function wcagColor(hslHueDeg, bgLum, targetC) {
  const hr = (hslHueToOklch(hslHueDeg) * Math.PI) / 180, ca = Math.cos(hr), sa = Math.sin(hr);
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

// 조건 8: 명암비 슬라이더 범위 = WCAG 3:1~7:1(사용자 스펙 step5). 전역 maximin(자유색 4개) Range A는
// 다크 [3.80,4.60]·라이트 [3.60,4.40]로 [3,7] 안에 들어온다(기본값=Max A).
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
