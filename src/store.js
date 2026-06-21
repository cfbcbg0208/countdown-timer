// 카운트다운 목록 저장소. storage(localStorage 호환 객체)를 주입받아 테스트 가능하게 한다.
// 항목 형태: { id, label, targetISO, createdAt }
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
  const item = { id: newId(), label, targetISO, createdAt: new Date().toISOString() };
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
