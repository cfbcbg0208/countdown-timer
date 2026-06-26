import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, save, update, reset, DEFAULTS, SCALE_MIN, SCALE_MAX } from '../src/settings.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('빈 저장소 → 기본값', () => {
  const s = load(fakeStorage());
  assert.deepEqual(s, DEFAULTS);
});

test('update: 일부 키만 갱신 + 병합 영속', () => {
  const st = fakeStorage();
  update(st, { timerScale: 1.5 });
  update(st, { accent: 'pink' });
  const s = load(st);
  assert.equal(s.timerScale, 1.5);
  assert.equal(s.accent, 'pink');
  assert.equal(s.density, DEFAULTS.density); // 건드리지 않은 값 보존
});

test('범위 밖 scale → 클램프(timer/meta/lap)', () => {
  const st = fakeStorage();
  assert.equal(update(st, { timerScale: 99 }).timerScale, SCALE_MAX);
  assert.equal(update(st, { timerScale: 0 }).timerScale, SCALE_MIN);
  assert.equal(update(st, { metaScale: 'x' }).metaScale, 1); // 숫자 아님 → 1
  assert.equal(update(st, { metaScale: 99 }).metaScale, SCALE_MAX);
  assert.equal(update(st, { lapScale: 0 }).lapScale, SCALE_MIN);
});

test('addPosition: 기본 top, bottom만 허용, 그 외 → top', () => {
  const st = fakeStorage();
  assert.equal(load(st).addPosition, 'top'); // 기본값
  assert.equal(update(st, { addPosition: 'bottom' }).addPosition, 'bottom');
  assert.equal(update(st, { addPosition: 'sideways' }).addPosition, 'top'); // 잘못된 값 폴백
});

test('progressStyle: 기본 both, 허용값만, 그 외 → both', () => {
  const st = fakeStorage();
  assert.equal(load(st).progressStyle, 'both'); // 기본값
  for (const v of ['none', 'bar', 'pie', 'both']) {
    assert.equal(update(st, { progressStyle: v }).progressStyle, v);
  }
  assert.equal(update(st, { progressStyle: 'rainbow' }).progressStyle, 'both'); // 폴백
});

test('showCreated/showUpdated: 기본 false, 불리언 강제', () => {
  const st = fakeStorage();
  assert.equal(load(st).showCreated, false);
  assert.equal(load(st).showUpdated, false);
  assert.equal(update(st, { showCreated: 1 }).showCreated, true); // truthy → true
  assert.equal(update(st, { showUpdated: 0 }).showUpdated, false); // falsy → false
});

test('progressBase: 기본 created, updated만 허용, 그 외 → created', () => {
  const st = fakeStorage();
  assert.equal(load(st).progressBase, 'created'); // 기본값
  assert.equal(update(st, { progressBase: 'updated' }).progressBase, 'updated');
  assert.equal(update(st, { progressBase: 'foo' }).progressBase, 'created'); // 폴백
});

test('잘못된 accent/density → 기본값 폴백', () => {
  const st = fakeStorage();
  const s = update(st, { accent: 'rainbow', density: 'huge' });
  assert.equal(s.accent, DEFAULTS.accent);
  assert.equal(s.density, DEFAULTS.density);
});

test('손상된 JSON → 기본값으로 안전 복구', () => {
  const st = fakeStorage();
  st.setItem('settings', '{not json');
  assert.deepEqual(load(st), DEFAULTS);
});

test('reset: 기본값으로 되돌림', () => {
  const st = fakeStorage();
  update(st, { metaScale: 1.4, timerScale: 1.5, accent: 'green' });
  assert.deepEqual(reset(st), DEFAULTS);
  assert.deepEqual(load(st), DEFAULTS);
});

test('save는 정규화된 값을 반환', () => {
  const st = fakeStorage();
  const s = save(st, { timerScale: 5, accent: 'violet' });
  assert.equal(s.timerScale, SCALE_MAX);
  assert.equal(s.accent, 'violet');
});
