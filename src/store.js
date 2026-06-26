// 카운트다운 목록 저장소. storage(localStorage 호환 객체)를 주입받아 테스트 가능하게 한다.
// 항목 형태: { id, label, targetISO, createdAt, updatedAt }
//   createdAt=등록 일시, updatedAt=마지막 수정 일시(updateItem 시 갱신). 둘 다 ISO 문자열.
const KEY = 'countdowns';

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 저장된 목록을 반환. 없거나 손상되면 빈 배열. */
export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function save(storage, list) {
  storage.setItem(KEY, JSON.stringify(list));
}

/** 새 항목 추가 후 그 항목을 반환. */
export function add(storage, { label = '', targetISO }) {
  const list = load(storage);
  const now = new Date().toISOString();
  const item = { id: newId(), label, targetISO, createdAt: now, updatedAt: now };
  list.push(item);
  save(storage, list);
  return item;
}

/** id 항목 삭제 후 남은 목록을 반환. */
export function remove(storage, id) {
  const list = load(storage).filter((t) => t.id !== id);
  save(storage, list);
  return list;
}

/** id 항목의 일부 필드(label/targetISO 등)를 갱신 후 남은 목록을 반환.
 *  id·createdAt·순서는 보존하고, updatedAt은 현재 시각으로 갱신(patch로 못 바꿈). */
export function updateItem(storage, id, patch) {
  const list = load(storage).map((t) =>
    t.id === id
      ? { ...t, ...patch, id: t.id, createdAt: t.createdAt, updatedAt: new Date().toISOString() }
      : t,
  );
  save(storage, list);
  return list;
}

/**
 * 저장 목록을 orderedIds 순서대로 재배치 후 저장하고 새 목록을 반환.
 * 목록에 없는 id는 무시하고, orderedIds에 빠진 항목은 원래 상대순서로 끝에 보존(유실 방지).
 * 드래그&드롭으로 정한 수동 순서를 영속화하는 데 사용한다.
 */
export function reorder(storage, orderedIds) {
  const list = load(storage);
  const byId = new Map(list.map((t) => [t.id, t]));
  const next = [];
  for (const id of orderedIds) {
    const item = byId.get(id);
    if (item) {
      next.push(item);
      byId.delete(id);
    }
  }
  for (const item of list) if (byId.has(item.id)) next.push(item); // orderedIds에 없던 항목 보존
  save(storage, next);
  return next;
}

/**
 * id 배열에서 id를 delta만큼(+ 아래/− 위) 이동한 새 배열을 반환. 원본 불변.
 * 목적지가 범위를 벗어나면 양 끝으로 클램프(Home=−길이, End=+길이로 호출 가능).
 * id가 없거나 위치가 그대로면 원본의 얕은 복사를 그대로 반환한다.
 * 드래그 대신 키보드(↑/↓/Home/End)로 순서를 바꿀 때 쓴다.
 */
export function moveId(ids, id, delta) {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  if (to === from) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** 정렬: 미래(임박 순) 먼저, 그다음 과거(최근 지난 순). 원본 불변. */
export function sortByUrgency(list, now = Date.now()) {
  return [...list].sort((a, b) => {
    const ta = new Date(a.targetISO).getTime();
    const tb = new Date(b.targetISO).getTime();
    const fa = ta >= now;
    const fb = tb >= now;
    if (fa !== fb) return fa ? -1 : 1; // 미래 먼저
    return fa ? ta - tb : tb - ta; // 미래는 가까운 순, 과거는 최근 순
  });
}

// ── 타임카드 조합(그룹) 저장소: 사용자가 카드들을 묶어 이름 붙여 저장 ──
// 그룹 형태: { id, name, itemIds: string[], createdAt }
const KEY_GROUPS = 'groups';

/** 저장된 그룹 목록. 없거나 손상되면 빈 배열. */
export function loadGroups(storage) {
  try {
    const raw = storage.getItem(KEY_GROUPS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveGroups(storage, groups) {
  storage.setItem(KEY_GROUPS, JSON.stringify(groups));
}

/** 새 그룹 추가 후 그 그룹을 반환. */
export function addGroup(storage, { name = '', itemIds = [] }) {
  const groups = loadGroups(storage);
  const group = { id: newId(), name, itemIds: [...itemIds], createdAt: new Date().toISOString() };
  groups.push(group);
  saveGroups(storage, groups);
  return group;
}

/** id 그룹 삭제 후 남은 그룹을 반환. */
export function removeGroup(storage, id) {
  const groups = loadGroups(storage).filter((g) => g.id !== id);
  saveGroups(storage, groups);
  return groups;
}

/** id 그룹 이름 변경 후 그룹 목록 반환. */
export function renameGroup(storage, id, name) {
  const groups = loadGroups(storage).map((g) => (g.id === id ? { ...g, name } : g));
  saveGroups(storage, groups);
  return groups;
}

/** id 그룹의 멤버(itemIds) 교체 후 그룹 목록 반환. */
export function setGroupItems(storage, id, itemIds) {
  const groups = loadGroups(storage).map((g) => (g.id === id ? { ...g, itemIds: [...itemIds] } : g));
  saveGroups(storage, groups);
  return groups;
}

/** 항목 삭제 시 모든 그룹 멤버에서 그 id를 제거(깨진 참조 방지). 그룹 목록 반환. */
export function removeItemFromGroups(storage, itemId) {
  const groups = loadGroups(storage).map((g) => ({
    ...g,
    itemIds: (g.itemIds || []).filter((x) => x !== itemId),
  }));
  saveGroups(storage, groups);
  return groups;
}

/** (순수) 그 항목이 속한 그룹들만. */
export function groupsForItem(groups, itemId) {
  return groups.filter((g) => Array.isArray(g.itemIds) && g.itemIds.includes(itemId));
}
