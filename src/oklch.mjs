// 컬러코딩 색 계산(0-dep, ES 모듈). Node 생성기(tools/gen-palette.mjs)와 브라우저(app.js) 공용.
// 철학: memory color-coding-philosophy / 글로벌 CLAUDE.md.
// 고정 RGB원색(빨/녹/파) + OKLCH(지각 균일) 균등 자유색. 배경 대비 WCAG 명암비를 모두 동일하게,
// (L,C)를 조절해 채도 최대. 명암비는 '양자화된 hex' 기준으로 계산해 실제 렌더값이 목표에 맞게.

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

// 주어진 OKLCH hue·배경휘도에서 목표 WCAG 명암비를 내는 색 중 채도(C) 최대인 양자화 hex.
// 명암비는 '양자화된 hex' 기준으로 계산(실제 렌더값) → 소수점 1자리까지 목표에 일치.
export function solveOklch(hueDeg, bgLum, target) {
  const hr = (hueDeg * Math.PI) / 180, ca = Math.cos(hr), sa = Math.sin(hr);
  const inGamut = (lin) => lin.every((v) => v >= -0.0002 && v <= 1.0002);
  const maxC = (L) => { let lo = 0, hi = 0.4; for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (inGamut(oklabToLin([L, m * ca, m * sa]))) lo = m; else hi = m; } return lo; };
  const colorAt = (L, C) => {
    const rgb = oklabToLin([L, C * ca, C * sa]).map((v) => toSrgb(Math.min(1, Math.max(0, v))));
    return { rgb, ct: contrast(relLum(rgb.map(toLin)), bgLum) };
  };
  // 1) 이분탐색으로 max-C 기준 명암비=target 인 L 위치를 대략 찾음.
  const dir = bgLum < 0.5 ? 1 : -1; // 다크: L↑→명암비↑ / 라이트: L↑→명암비↓
  let lo = 0.02, hi = 1;
  for (let i = 0; i < 36; i++) { const mid = (lo + hi) / 2; if ((colorAt(mid, maxC(mid)).ct < target) === (dir > 0)) lo = mid; else hi = mid; }
  // 2) 주변 (L,C) 격자 미세탐색 → 양자화 후 target에 '반올림 일치'(±0.045)하는 색 중 채도 최대.
  //    (최근접만 쫓으면 무채색을 골라 탁해짐 → 일치 허용오차 안에서 가장 선명한 색 선택.)
  const TOL = 0.045;
  let best = null, near = { rgb: [128, 128, 128], C: 0, ct: 1, d: 99 };
  for (let L = Math.max(0.02, lo - 0.06); L <= Math.min(1, lo + 0.06); L += 0.0025) {
    const mc = maxC(L);
    for (let C = mc; C >= 0; C -= 0.004) {
      const c = colorAt(L, C), d = Math.abs(c.ct - target);
      if (d < near.d) near = { rgb: c.rgb, C, ct: c.ct, d };
      if (d <= TOL && (!best || C > best.C)) best = { rgb: c.rgb, C, ct: c.ct };
    }
  }
  return best || near; // 허용오차 내 없으면 최근접 폴백

}

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
