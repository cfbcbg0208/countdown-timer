import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, save, update, reset, DEFAULTS } from '../src/settings.js';

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
  update(st, { progressStyle: 'bar' });
  update(st, { addPosition: 'bottom' });
  const s = load(st);
  assert.equal(s.progressStyle, 'bar');
  assert.equal(s.addPosition, 'bottom');
  assert.equal(s.theme, DEFAULTS.theme); // 건드리지 않은 값 보존
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

test('progressBase: 기본 created, updated만 허용, 그 외 → created', () => {
  const st = fakeStorage();
  assert.equal(load(st).progressBase, 'created'); // 기본값
  assert.equal(update(st, { progressBase: 'updated' }).progressBase, 'updated');
  assert.equal(update(st, { progressBase: 'foo' }).progressBase, 'created'); // 폴백
});

test('표시 기본값: 기준일시 보임, 등록/수정 숨김 + 불리언 강제', () => {
  const st = fakeStorage();
  assert.equal(load(st).showTarget, true); // 기준일시 기본 보임
  assert.equal(load(st).showCreated, false); // 등록일시 기본 숨김
  assert.equal(load(st).showUpdated, false); // 수정일시 기본 숨김
  assert.equal(update(st, { showCreated: 1 }).showCreated, true); // truthy → true
  assert.equal(update(st, { showTarget: 0 }).showTarget, false); // falsy → false
});

test('theme: 기본 dark, light만 허용, 그 외 → dark', () => {
  const st = fakeStorage();
  assert.equal(load(st).theme, 'dark');
  assert.equal(update(st, { theme: 'light' }).theme, 'light');
  assert.equal(update(st, { theme: 'solarized' }).theme, 'dark'); // 폴백
});

test('weekStart: 기본 mon, sun만 허용, 그 외 → mon', () => {
  const st = fakeStorage();
  assert.equal(load(st).weekStart, 'mon');
  assert.equal(update(st, { weekStart: 'sun' }).weekStart, 'sun');
  assert.equal(update(st, { weekStart: 'tue' }).weekStart, 'mon'); // 폴백
});

test('손상된 JSON → 기본값으로 안전 복구', () => {
  const st = fakeStorage();
  st.setItem('settings', '{not json');
  assert.deepEqual(load(st), DEFAULTS);
});

test('reset: 기본값으로 되돌림', () => {
  const st = fakeStorage();
  update(st, { theme: 'light', addPosition: 'bottom', showCreated: true });
  assert.deepEqual(reset(st), DEFAULTS);
  assert.deepEqual(load(st), DEFAULTS);
});
