// 디자인 설정 저장소(로컬 전용). storage(localStorage 호환)를 주입받아 테스트 가능하게 한다.
// 값: timerScale/metaScale/lapScale(배수) · accent(키) · density(키)
//     · addPosition('top'|'bottom': 새 카드 추가 위치)
const KEY = 'settings';

// 강조색 프리셋(키 → HEX). 남은=초록/지난=빨강 규칙과는 별개.
export const ACCENTS = {
  blue: '#5b8cff',
  violet: '#a78bfa',
  pink: '#f472b6',
  amber: '#fbbf24',
  green: '#34d399',
  red: '#f87171',
};

// 카드 간격(밀도) 프리셋(키 → CSS 길이).
export const DENSITY = { compact: '0.3rem', normal: '0.6rem', comfortable: '1rem' };

export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.8;

export const DEFAULTS = {
  timerScale: 1,
  metaScale: 1, // 기준일시 글자 크기 배수
  lapScale: 1, // 기록(랩) 글자 크기 배수
  accent: 'blue',
  density: 'normal',
  addPosition: 'top', // 새 카드는 기본적으로 목록 맨 앞에 추가
};

const clampScale = (n) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, v)) : 1;
};

// 어떤 입력이든 유효한 설정 객체로 정규화(범위 클램프·잘못된 키 폴백).
function coerce(s) {
  const o = s && typeof s === 'object' ? s : {};
  return {
    timerScale: clampScale(o.timerScale),
    metaScale: clampScale(o.metaScale),
    lapScale: clampScale(o.lapScale),
    accent: ACCENTS[o.accent] ? o.accent : DEFAULTS.accent,
    density: DENSITY[o.density] ? o.density : DEFAULTS.density,
    addPosition: o.addPosition === 'bottom' ? 'bottom' : 'top', // 그 외/누락 → top
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
