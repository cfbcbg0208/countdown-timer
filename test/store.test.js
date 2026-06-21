import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, save, add, remove, reorder, sortByUrgency } from '../src/store.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('빈 저장소 → []', () => assert.deepEqual(load(fakeStorage()), []));

test('add → load 로 복원, 필드 보존', () => {
  const s = fakeStorage();
  const item = add(s, { label: '시험', targetISO: '2026-12-31T09:00:00' });
  const list = load(s);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, '시험');
  assert.equal(list[0].targetISO, '2026-12-31T09:00:00');
  assert.ok(list[0].id && list[0].createdAt);
});

test('여러 개 add 후 영속', () => {
  const s = fakeStorage();
  add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  add(s, { label: 'b', targetISO: '2026-02-01T00:00:00' });
  assert.equal(load(s).length, 2);
});

test('add: 고유 id 부여', () => {
  const s = fakeStorage();
  const a = add(s, { targetISO: '2026-01-01T00:00:00' });
  const b = add(s, { targetISO: '2026-01-02T00:00:00' });
  assert.notEqual(a.id, b.id);
});

test('remove → 해당 항목만 삭제', () => {
  const s = fakeStorage();
  const a = add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  add(s, { label: 'b', targetISO: '2026-02-01T00:00:00' });
  const after = remove(s, a.id);
  assert.equal(after.length, 1);
  assert.equal(after[0].label, 'b');
  assert.equal(load(s).length, 1);
});

test('손상된 JSON → [] 로 안전 복구', () => {
  const s = fakeStorage();
  s.setItem('countdowns', '{not json');
  assert.deepEqual(load(s), []);
});

test('reorder: 주어진 id 순서대로 저장 목록 재배치 + 영속', () => {
  const s = fakeStorage();
  const a = add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  const b = add(s, { label: 'b', targetISO: '2026-02-01T00:00:00' });
  const c = add(s, { label: 'c', targetISO: '2026-03-01T00:00:00' });
  const after = reorder(s, [c.id, a.id, b.id]);
  assert.deepEqual(after.map((x) => x.label), ['c', 'a', 'b']);
  assert.deepEqual(load(s).map((x) => x.label), ['c', 'a', 'b']);
});

test('reorder: 모르는 id 무시, 빠진 항목은 끝에 보존', () => {
  const s = fakeStorage();
  const a = add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  const b = add(s, { label: 'b', targetISO: '2026-02-01T00:00:00' });
  const c = add(s, { label: 'c', targetISO: '2026-03-01T00:00:00' });
  // b만 명시 + 존재하지 않는 id → a, c는 원래 상대순서로 뒤에 보존
  const after = reorder(s, ['ghost', b.id]);
  assert.deepEqual(after.map((x) => x.label), ['b', 'a', 'c']);
  assert.equal(after.length, 3);
  assert.ok(a.id && c.id);
});

test('sortByUrgency: 미래 임박 순 먼저, 과거 최근 순 뒤', () => {
  const now = new Date(2026, 5, 21, 0, 0, 0).getTime();
  const list = [
    { id: '1', targetISO: '2026-06-20T00:00:00' }, // 과거 1일 전
    { id: '2', targetISO: '2026-06-25T00:00:00' }, // 미래 4일 후
    { id: '3', targetISO: '2026-06-22T00:00:00' }, // 미래 1일 후
    { id: '4', targetISO: '2026-06-10T00:00:00' }, // 과거 11일 전
  ];
  assert.deepEqual(sortByUrgency(list, now).map((x) => x.id), ['3', '2', '1', '4']);
});

test('sortByUrgency: 원본 배열 불변', () => {
  const list = [{ id: 'a', targetISO: '2026-01-01T00:00:00' }];
  const copy = [...list];
  sortByUrgency(list, Date.now());
  assert.deepEqual(list, copy);
});
