// 0-dep dev 도구: 타임라인 노드 팔레트 산출.
// 고정 hue에서 (S,L)을 함께 탐색해 카드 배경 대비 목표 WCAG 명암비를 내는 색 중
// 채도(chroma)가 가장 큰(=가장 선명한) 해를 고른다. 다크/라이트 두 테마 각각 산출.
// 앱 번들엔 미포함 — 산출 hex를 style.css 변수에 붙여넣기 위한 계산기.
// 실행: node tools/gen-palette.mjs

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
const srgbToLin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
const contrast = (l1, l2) => {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
};
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const hexToRgb = (h) => {
  h = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
function rgbToHue([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

// 주어진 hue에서 목표 명암비를 내는 (S,L) 중 chroma 최대인 색. S=0이면 무채색.
function solve(hue, bgLum, target, { sMin = 0, sMax = 1, tol = 0.06 } = {}) {
  let best = null;
  for (let s = sMax; s >= sMin - 1e-9; s -= 0.01) {
    for (let l = 0; l <= 1.0001; l += 0.003) {
      const rgb = hslToRgb(hue, s, l);
      const ct = contrast(relLum(rgb), bgLum);
      if (Math.abs(ct - target) <= tol) {
        const ch = chroma(rgb);
        if (!best || ch > best.ch) best = { rgb, s, l, ct, ch };
      }
    }
  }
  return best;
}

const THEMES = [
  { name: 'dark ', cardHex: '#17211c', futureHex: '#6cb0ff' }, // :root
  { name: 'light', cardHex: '#ffffff', futureHex: '#0a57cc' }, // [data-theme='light']
];
// 빨강·파랑·녹색(강조색) 제외 등분: 앰버 40 / 청록 170 / 마젠타 300.
const NODES = [
  { key: '--node-origin ', label: '등록·시작 앰버 40°', hue: 40, target: 7 },
  { key: '--node-updated', label: '수정     청록 170°', hue: 170, target: 7 },
  { key: '--node-target ', label: '기준     마젠타 300°', hue: 300, target: 7 },
  { key: '--node-now    ', label: '현재     무채색', hue: 0, target: 7, neutral: true },
];
const DIM_TARGET = 2.5; // 남은시간 흐린 파랑(채움 바라 명암비 느슨)

for (const t of THEMES) {
  const bgLum = relLum(hexToRgb(t.cardHex));
  console.log(`\n=== ${t.name.trim()} theme (card ${t.cardHex}, bgLum=${bgLum.toFixed(4)}) ===`);
  for (const n of NODES) {
    const r = n.neutral ? solve(0, bgLum, n.target, { sMin: 0, sMax: 0 }) : solve(n.hue, bgLum, n.target);
    console.log(`  ${n.key}: ${hex(r.rgb)};  /* ${n.label.padEnd(18)} 명암비 ${r.ct.toFixed(2)}:1, S=${r.s.toFixed(2)} */`);
  }
  const dimHue = rgbToHue(hexToRgb(t.futureHex));
  const d = solve(dimHue, bgLum, DIM_TARGET, { sMin: 0.15 });
  console.log(`  --future-dim  : ${hex(d.rgb)};  /* 남은시간 흐린파랑 hue${dimHue.toFixed(0)}° 명암비 ${d.ct.toFixed(2)}:1, S=${d.s.toFixed(2)} */`);
}
