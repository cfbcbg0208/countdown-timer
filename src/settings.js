// 디자인 설정 저장소(로컬 전용). storage(localStorage 호환)를 주입받아 테스트 가능하게 한다.
// 값: addPosition · progressStyle · progressBase · showTarget/Created/Updated · theme.
// (강조색·카드 간격·글자 크기 옵션은 제거 — 녹색 고정·기본 크기. 단순·통일 지향.)
const KEY = 'settings';

export const DEFAULTS = {
  addPosition: 'top', // 새 카드는 기본적으로 목록 맨 앞에 추가
  progressStyle: 'both', // 남은 시간 진행률 그래픽: 'none'|'bar'|'pie'|'both'
  progressBase: 'created', // 진행률 0% 기준: 'created'(등록일시) | 'updated'(수정일시)
  showTarget: true, // 카드에 기준일시 표시(기본 보임)
  showCreated: false, // 카드에 등록일시 표시(기본 숨김)
  showUpdated: false, // 카드에 수정일시 표시(기본 숨김)
  theme: 'dark', // 화면 테마: 'dark' | 'light'
};

const PROGRESS_STYLES = ['none', 'bar', 'pie', 'both'];

// 어떤 입력이든 유효한 설정 객체로 정규화(잘못된 값 폴백).
function coerce(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    addPosition: o.addPosition === 'bottom' ? 'bottom' : 'top', // 그 외/누락 → top
    progressStyle: PROGRESS_STYLES.includes(o.progressStyle) ? o.progressStyle : DEFAULTS.progressStyle,
    progressBase: o.progressBase === 'updated' ? 'updated' : 'created', // 그 외/누락 → created
    showTarget: !!o.showTarget,
    showCreated: !!o.showCreated,
    showUpdated: !!o.showUpdated,
    theme: o.theme === 'light' ? 'light' : 'dark', // 그 외/누락 → dark
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
