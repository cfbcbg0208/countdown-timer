import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGroups,
  addGroup,
  removeGroup,
  renameGroup,
  setGroupItems,
  removeItemFromGroups,
  groupsForItem,
} from '../src/store.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('빈 저장소 → 그룹 []', () => assert.deepEqual(loadGroups(fakeStorage()), []));

test('addGroup → load로 복원, 필드 보존', () => {
  const s = fakeStorage();
  const g = addGroup(s, { name: '시험', itemIds: ['a', 'b'] });
  const groups = loadGroups(s);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, '시험');
  assert.deepEqual(groups[0].itemIds, ['a', 'b']);
  assert.ok(g.id && g.createdAt);
});

test('addGroup: itemIds 복사(원본과 분리)', () => {
  const s = fakeStorage();
  const ids = ['a'];
  const g = addGroup(s, { name: 'x', itemIds: ids });
  ids.push('b');
  assert.deepEqual(loadGroups(s)[0].itemIds, ['a']); // 외부 배열 변경에 영향 없음
  assert.ok(g);
});

test('removeGroup → 해당 그룹만 삭제', () => {
  const s = fakeStorage();
  const a = addGroup(s, { name: 'a', itemIds: [] });
  addGroup(s, { name: 'b', itemIds: [] });
  const after = removeGroup(s, a.id);
  assert.equal(after.length, 1);
  assert.equal(after[0].name, 'b');
});

test('renameGroup: 이름만 변경', () => {
  const s = fakeStorage();
  const a = addGroup(s, { name: 'old', itemIds: ['x'] });
  const after = renameGroup(s, a.id, 'new');
  assert.equal(after[0].name, 'new');
  assert.deepEqual(after[0].itemIds, ['x']); // 멤버 보존
});

test('setGroupItems: 멤버 교체', () => {
  const s = fakeStorage();
  const a = addGroup(s, { name: 'a', itemIds: ['x'] });
  const after = setGroupItems(s, a.id, ['y', 'z']);
  assert.deepEqual(after[0].itemIds, ['y', 'z']);
});

test('removeItemFromGroups: 모든 그룹에서 id 제거', () => {
  const s = fakeStorage();
  addGroup(s, { name: 'a', itemIds: ['x', 'y'] });
  addGroup(s, { name: 'b', itemIds: ['y', 'z'] });
  const after = removeItemFromGroups(s, 'y');
  assert.deepEqual(after[0].itemIds, ['x']);
  assert.deepEqual(after[1].itemIds, ['z']);
});

test('groupsForItem(순수): 그 항목이 속한 그룹만', () => {
  const groups = [
    { id: '1', name: 'a', itemIds: ['x', 'y'] },
    { id: '2', name: 'b', itemIds: ['z'] },
    { id: '3', name: 'c', itemIds: ['y'] },
  ];
  assert.deepEqual(groupsForItem(groups, 'y').map((g) => g.id), ['1', '3']);
  assert.deepEqual(groupsForItem(groups, 'none'), []);
});

test('손상된 JSON → 그룹 []로 안전 복구', () => {
  const s = fakeStorage();
  s.setItem('groups', '{not json');
  assert.deepEqual(loadGroups(s), []);
});
