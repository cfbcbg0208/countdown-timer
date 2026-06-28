import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  load,
  save,
  add,
  remove,
  reorder,
  updateItem,
  setHidden,
  moveId,
  sortByUrgency,
} from '../src/store.js';

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

test('add: createdAt·updatedAt 설정(처음엔 동일)', () => {
  const s = fakeStorage();
  const item = add(s, { targetISO: '2026-01-01T00:00:00' });
  assert.ok(item.createdAt);
  assert.equal(item.updatedAt, item.createdAt);
});

test('updateItem: updatedAt 갱신, createdAt 보존', async () => {
  const s = fakeStorage();
  const a = add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  await new Promise((r) => setTimeout(r, 2)); // ISO ms가 달라지도록 약간 대기
  const after = updateItem(s, a.id, { label: 'a2' });
  assert.equal(after[0].createdAt, a.createdAt); // 등록 일시 보존
  assert.notEqual(after[0].updatedAt, a.updatedAt); // 수정 일시 갱신됨
  assert.ok(after[0].updatedAt > a.updatedAt); // 더 이후 시각
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

test('updateItem: targetISO 갱신, id·createdAt·순서·다른 항목 보존', () => {
  const s = fakeStorage();
  const a = add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  const b = add(s, { label: 'b', targetISO: '2026-02-01T00:00:00' });
  const after = updateItem(s, a.id, { targetISO: '2026-03-03T03:03:03' });
  assert.equal(after.length, 2);
  assert.equal(after[0].id, a.id); // 순서 유지(첫째)
  assert.equal(after[0].targetISO, '2026-03-03T03:03:03');
  assert.equal(after[0].createdAt, a.createdAt); // 보존
  assert.equal(after[1].targetISO, b.targetISO); // 다른 항목 불변
});

test('updateItem: id·createdAt는 patch로 못 바꿈', () => {
  const s = fakeStorage();
  const a = add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  const after = updateItem(s, a.id, { id: 'HACK', createdAt: 'X', label: 'a2' });
  assert.equal(after[0].id, a.id);
  assert.equal(after[0].createdAt, a.createdAt);
  assert.equal(after[0].label, 'a2');
});

test('updateItem: 없는 id면 변화 없음', () => {
  const s = fakeStorage();
  add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  const after = updateItem(s, 'ghost', { targetISO: '2099-01-01T00:00:00' });
  assert.equal(after.length, 1);
  assert.equal(after[0].targetISO, '2026-01-01T00:00:00');
});

test('setHidden: hidden 토글 + updatedAt·createdAt·순서 보존', () => {
  const s = fakeStorage();
  const a = add(s, { label: 'a', targetISO: '2026-01-01T00:00:00' });
  add(s, { label: 'b', targetISO: '2026-02-01T00:00:00' });
  const before = load(s).find((t) => t.id === a.id).updatedAt;
  const after = setHidden(s, a.id, true);
  const itemA = after.find((t) => t.id === a.id);
  assert.equal(itemA.hidden, true);
  assert.equal(itemA.updatedAt, before); // 숨김은 수정으로 치지 않음(updatedAt 불변)
  assert.equal(itemA.createdAt, a.createdAt);
  assert.deepEqual(after.map((t) => t.label), ['a', 'b']); // 순서 보존
  // 다시 false → hidden 해제
  assert.equal(setHidden(s, a.id, false).find((t) => t.id === a.id).hidden, false);
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

test('moveId: 아래로(+1) 한 칸 이동', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
});

test('moveId: 위로(−1) 한 칸 이동', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
});

test('moveId: 범위 밖 delta는 양 끝으로 클램프(Home/End)', () => {
  assert.deepEqual(moveId(['a', 'b', 'c'], 'c', -3), ['c', 'a', 'b']); // 맨 위로
  assert.deepEqual(moveId(['a', 'b', 'c'], 'a', 3), ['b', 'c', 'a']); // 맨 아래로
});

test('moveId: 끝에서 더 못 가면 그대로(원본 불변)', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(moveId(ids, 'a', -1), ['a', 'b', 'c']); // 첫째를 위로 → 변화 없음
  assert.deepEqual(moveId(ids, 'c', 1), ['a', 'b', 'c']); // 막내를 아래로 → 변화 없음
  assert.deepEqual(ids, ['a', 'b', 'c']); // 입력 배열 불변
});

test('moveId: 없는 id면 원본 그대로 반환', () => {
  assert.deepEqual(moveId(['a', 'b'], 'ghost', 1), ['a', 'b']);
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
