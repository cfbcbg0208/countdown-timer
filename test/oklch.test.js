// 컬러코딩 색 계산(src/oklch.mjs) 자동 검증 — 스펙 조건 1~8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_HUES, roleHues, placeFree, hslHueToOklch, rangeA, solveWcagPalette, minPairwiseDE,
  wcagColor, wcagMaxC, SLIDER_MIN, SLIDER_MAX,
  hexToRgb, toLin, relLum, rgb255ToOklchHue,
} from '../src/oklch.mjs';

const ROLE = ['past', 'now', 'future', 'origin', 'updated', 'start', 'target'];
const hueArr = () => { const h = roleHues(); return ROLE.map((k) => h[k]); };
const BGS = [['dark', '#17211c'], ['light', '#ffffff']];

// 조건 1·2: 고정색 = HSL 0/120/240(빨/초/파). hue 분포는 HSL, 색은 그 HSL의 실제 sRGB 원색.
test('조건1·2: 고정 hue는 HSL 0/120/240, 실제 sRGB 원색과 매핑', () => {
  assert.equal(FIXED_HUES.red, 0);
  assert.equal(FIXED_HUES.green, 120);
  assert.equal(FIXED_HUES.blue, 240);
  // HSL hue → OKLCH 변환이 실제 sRGB 원색(빨/초/파)과 일치.
  assert.ok(Math.abs(hslHueToOklch(0) - rgb255ToOklchHue([255, 0, 0])) < 1e-9);
  assert.ok(Math.abs(hslHueToOklch(120) - rgb255ToOklchHue([0, 255, 0])) < 1e-9);
  assert.ok(Math.abs(hslHueToOklch(240) - rgb255ToOklchHue([0, 0, 255])) < 1e-9);
  const h = roleHues();
  assert.equal(h.past, FIXED_HUES.red);
  assert.equal(h.now, FIXED_HUES.green);
  assert.equal(h.future, FIXED_HUES.blue);
});

// 조건 1(핵심): placeFree는 '증분'이 아니라 N마다 자유 hue를 전역 maximin으로 전부 새로 계산.
//   → 고정점 사이 호별 균등분할의 min-subarc 최대(전역 상한)와 정확히 일치. 고정 HSL 0/120/240(120° 균등)이면 N=4서 [60,180,280,320].
test('조건1: placeFree는 전역 maximin — N마다 재계산, 호별 균등분할 상한과 일치', () => {
  const fixed = [FIXED_HUES.red, FIXED_HUES.green, FIXED_HUES.blue]; // HSL 0/120/240
  const arcs = [...fixed].sort((a, b) => a - b).map((h, i, s) => (i + 1 < s.length ? s[i + 1] : s[0] + 360) - h);
  // 호에 점 n개를 배분(합=n)하는 모든 조합의 min-subarc 최대 = 전역 최적 상한.
  const bestUpper = (n) => {
    let best = 0;
    const rec = (idx, left, ks) => {
      if (idx === arcs.length - 1) { const all = [...ks, left]; best = Math.max(best, Math.min(...arcs.map((w, i) => w / (all[i] + 1)))); return; }
      for (let k = 0; k <= left; k++) rec(idx + 1, left - k, [...ks, k]);
    };
    rec(0, n, []);
    return best;
  };
  const minGap = (arr) => { const s = [...arr].sort((a, b) => a - b); let m = 999; for (let i = 0; i < s.length; i++) { const g = ((s[(i + 1) % s.length] - s[i] + 360) % 360) || 360; m = Math.min(m, g); } return m; };
  for (let n = 1; n <= 6; n++) {
    const free = placeFree(fixed, n);
    assert.equal(free.length, n, `N=${n} 자유색 개수`);
    assert.ok(Math.abs(minGap([...fixed, ...free]) - bestUpper(n)) < 1e-6, `N=${n} min-gap ≠ 전역최적 ${bestUpper(n).toFixed(3)}°`);
  }
  // HSL 0/120/240(120° 균등)에서 N=4 자유색 = [60,180,280,320], 전체 7색 최소 간격 40°(증분/오배분이면 더 낮음).
  assert.deepEqual(placeFree(fixed, 4).map((x) => Math.round(x)), [60, 180, 280, 320], 'N=4 자유색 배치가 사용자 계산과 불일치');
  assert.ok(minGap([...fixed, ...placeFree(fixed, 4)]) >= 40 - 1e-9, 'N=4 전역 maximin(40°) 아님');
});

// 조건 3: 자유색 4개(시작 추가)가 360° 안에 고정 hue와 함께 최대한 고르게(maximin) 분포.
test('조건3: 자유 hue는 maximin으로 분포(이웃 간격이 충분히 큼)', () => {
  const h = roleHues();
  const all = [h.past, h.now, h.future, h.origin, h.updated, h.start, h.target].sort((a, b) => a - b);
  const gaps = all.map((v, i) => ((all[(i + 1) % all.length] - v + 360) % 360) || 360);
  // HSL 7색 [0,60,120,180,240,280,320] 최소 간격 = 40°(파랑↔빨강 호 3분할). 증분/오배분이면 더 낮음 → 40° 하한.
  assert.ok(Math.min(...gaps) >= 40 - 1e-9, `최소 hue 간격 ${Math.min(...gaps).toFixed(1)}° < 40°(전역 maximin 아님)`);
});

// 조건 8: 슬라이더 범위 = WCAG 3:1 ~ 7:1(사용자 스펙, 기본=7.0). Range A는 정보 표시용이며 슬라이더 밖일 수 있음
//   (HSL 분포에선 라이트 Range A 하한이 3 아래) → 유효성(minA<maxA·양수)만 확인, 포함은 강제하지 않음.
test('조건8: 슬라이더 범위 상수 3~7, Range A 유효', () => {
  assert.equal(SLIDER_MIN, 3);
  assert.equal(SLIDER_MAX, 7);
  for (const [, bg] of BGS) {
    const { minA, maxA } = rangeA(hueArr(), bg);
    assert.ok(minA > 0 && minA < maxA, `Range A [${minA},${maxA}] 무효`);
  }
});

for (const [name, bg] of BGS) {
  const bgLum = relLum(hexToRgb(bg).map(toLin));

  // 조건 5: 한 명암비에서 모든 색이 '같은 WCAG 명암비'(등 명암비, 양자화 오차만 허용).
  test(`조건5(${name}): 팔레트 색이 모두 목표 명암비에 근접`, () => {
    for (const target of [3, 4.5, 7]) {
      const pal = solveWcagPalette(hueArr(), bg, target);
      for (const p of pal) assert.ok(Math.abs(p.w - target) < 0.3, `${name} @${target}: ${p.w.toFixed(2)}`);
    }
  });

  // 조건 7: Range A = [minA, maxA] ⊂ [1.5, cmax], minA ≤ maxA, 기본값(maxA)은 슬라이더 범위 안.
  test(`조건7(${name}): Range A 경계가 타당`, () => {
    const { minA, maxA } = rangeA(hueArr(), bg);
    assert.ok(minA <= maxA, `minA ${minA} > maxA ${maxA}`);
    assert.ok(minA >= 1.5, `minA ${minA} < 1.5`);
    assert.ok(maxA <= wcagMaxC(bgLum) + 1e-9, `maxA ${maxA} > cmax`);
    assert.ok(maxA >= SLIDER_MIN && maxA <= SLIDER_MAX, `기본값 ${maxA} 슬라이더 밖`);
  });

  // 조건 6: Range A 안(maxA)의 색 구분력(min ΔE)이 Range A 밖(명암비를 크게 올림)보다 높다.
  test(`조건6(${name}): Range A 안이 밖보다 색 구분력 높음`, () => {
    const { maxA } = rangeA(hueArr(), bg);
    const inA = minPairwiseDE(solveWcagPalette(hueArr(), bg, maxA));
    const outA = minPairwiseDE(solveWcagPalette(hueArr(), bg, Math.min(SLIDER_MAX, maxA + 6)));
    assert.ok(inA > outA, `${name}: 안 ${inA.toFixed(3)} ≤ 밖 ${outA.toFixed(3)}`);
  });
}

// 회귀: wcagColor가 양 끝(저/고 명암비)에서도 폴백 없이 유효한 rgb를 반환.
test('wcagColor: 극단 명암비에서도 유효한 rgb', () => {
  for (const [, bg] of BGS) {
    const bgLum = relLum(hexToRgb(bg).map(toLin));
    for (const t of [1.5, 21]) {
      const c = wcagColor(0, bgLum, t);
      assert.ok(c.rgb.every((v) => v >= 0 && v <= 255 && Number.isInteger(v)));
    }
  }
});
