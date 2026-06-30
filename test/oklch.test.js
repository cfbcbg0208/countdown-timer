// 컬러코딩 색 계산(src/oklch.mjs) 자동 검증 — 스펙 조건 1~8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXED_HUES, roleHues, rangeA, solveWcagPalette, minPairwiseDE,
  wcagColor, wcagMaxC, SLIDER_MIN, SLIDER_MAX,
  hexToRgb, toLin, relLum, rgb255ToOklchHue,
} from '../src/oklch.mjs';

const ROLE = ['past', 'now', 'future', 'origin', 'updated', 'target'];
const hueArr = () => { const h = roleHues(); return ROLE.map((k) => h[k]); };
const BGS = [['dark', '#17211c'], ['light', '#ffffff']];

// 조건 1·2: 고정색 = sRGB 원색(빨/녹/파)의 OKLCH hue. 과거=빨강, 현재=초록, 미래=파랑.
test('조건1·2: 고정 hue는 sRGB 원색의 OKLCH hue', () => {
  assert.equal(FIXED_HUES.red, rgb255ToOklchHue([255, 0, 0]));
  assert.equal(FIXED_HUES.green, rgb255ToOklchHue([0, 255, 0]));
  assert.equal(FIXED_HUES.blue, rgb255ToOklchHue([0, 0, 255]));
  const h = roleHues();
  assert.equal(h.past, FIXED_HUES.red);
  assert.equal(h.now, FIXED_HUES.green);
  assert.equal(h.future, FIXED_HUES.blue);
});

// 조건 3: 자유색 3개가 360° 안에 고정 hue와 함께 최대한 고르게(maximin) 분포.
test('조건3: 자유 hue는 maximin으로 분포(이웃 간격이 충분히 큼)', () => {
  const h = roleHues();
  const all = [h.past, h.now, h.future, h.origin, h.updated, h.target].sort((a, b) => a - b);
  const gaps = all.map((v, i) => ((all[(i + 1) % all.length] - v + 360) % 360) || 360);
  // 6색이 완전 등간격이면 60°. maximin이므로 최소 간격이 40° 이상은 되어야 한다(뭉침 방지).
  assert.ok(Math.min(...gaps) >= 40, `최소 hue 간격 ${Math.min(...gaps).toFixed(1)}° < 40°`);
});

// 조건 8: 슬라이더 전체 범위 = WCAG 1:1 ~ 21:1.
test('조건8: 슬라이더 범위 상수 1~21', () => {
  assert.equal(SLIDER_MIN, 1);
  assert.equal(SLIDER_MAX, 21);
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
