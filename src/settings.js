// 디자인 설정 저장소(로컬 전용). storage(localStorage 호환)를 주입받아 테스트 가능하게 한다.
// 값: addPosition · progressStyle · progressBase · showTarget/Created/Updated · theme.
// (강조색·카드 간격·글자 크기 옵션은 제거 — 녹색 고정·기본 크기. 단순·통일 지향.)
const KEY = 'settings';

// 진행률 구성요소: 바·파이·퍼센트. 표시 여부(progressShow) + 순서(progressOrder)를 따로 둔다.
export const PROGRESS_PARTS = ['bar', 'pie', 'percent'];

export const DEFAULTS = {
  addPosition: 'top', // 새 카드는 기본적으로 목록 맨 앞에 추가
  progressOrder: ['bar', 'pie', 'percent'], // 진행률 구성요소 순서(설정에서 재배치)
  progressShow: { bar: true, pie: true, percent: true }, // 각 요소 표시 여부(기본 전부)
  progressBase: 'created', // 진행률 0% 기준: 'created'(등록일시) | 'updated'(수정일시)
  dateFormat: 'compact', // 카드 날짜 표시: 'compact'(260628일210436) | 'full'(2026-06-28 일 …)
  showTarget: true, // 카드에 기준일시 표시(기본 보임)
  showCreated: false, // 카드에 등록일시 표시(기본 숨김)
  showUpdated: false, // 카드에 수정일시 표시(기본 숨김)
  theme: 'dark', // 화면 테마: 'dark' | 'light'
  weekStart: 'mon', // 캘린더 시작 요일: 'mon' | 'sun'
};

// 순서 배열을 PARTS의 유효한 순열로 정규화(중복 제거 + 빠진 건 기본 순서로 뒤에 보충).
function coerceOrder(v) {
  const arr = Array.isArray(v) ? v.filter((p) => PROGRESS_PARTS.includes(p)) : [];
  const out = [];
  for (const p of arr) if (!out.includes(p)) out.push(p);
  for (const p of PROGRESS_PARTS) if (!out.includes(p)) out.push(p);
  return out;
}
// 표시 여부: 각 파트 불리언(누락/잘못된 값 → true=표시).
function coerceShow(v) {
  const o = v && typeof v === 'object' ? v : {};
  return { bar: o.bar !== false, pie: o.pie !== false, percent: o.percent !== false };
}

// 어떤 입력이든 유효한 설정 객체로 정규화(잘못된 값 폴백).
function coerce(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    addPosition: o.addPosition === 'bottom' ? 'bottom' : 'top', // 그 외/누락 → top
    progressOrder: coerceOrder(o.progressOrder),
    progressShow: coerceShow(o.progressShow),
    progressBase: o.progressBase === 'updated' ? 'updated' : 'created', // 그 외/누락 → created
    dateFormat: o.dateFormat === 'full' ? 'full' : 'compact', // 그 외/누락 → compact
    showTarget: !!o.showTarget,
    showCreated: !!o.showCreated,
    showUpdated: !!o.showUpdated,
    theme: o.theme === 'light' ? 'light' : 'dark', // 그 외/누락 → dark
    weekStart: o.weekStart === 'sun' ? 'sun' : 'mon', // 그 외/누락 → mon
  };
}

/** 저장된 설정을 기본값 위에 병합해 반환. 없거나 손상되면 기본값. */
export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return coerce({ ...DEFAULTS, ...obj });
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(storage, settings) {
  const next = coerce({ ...DEFAULTS, ...settings });
  storage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** 일부 키만 갱신(patch) 후 정규화·저장하고 새 설정을 반환. */
export function update(storage, patch) {
  return save(storage, { ...load(storage), ...patch });
}

/** 기본값으로 초기화 후 저장하고 반환. */
export function reset(storage) {
  return save(storage, { ...DEFAULTS });
}
