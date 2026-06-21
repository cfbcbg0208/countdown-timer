// 순수 시간 로직 — DOM·브라우저 API에 의존하지 않음(그래서 node:test로 검증 가능).
// 책임: 입력 파싱 → 현재와의 차이 계산 → 사람이 읽는 문자열 포맷.

const MS_UNIX_THRESHOLD = 1e12; // 이 값 이상이면 밀리초, 미만이면 초 단위 유닉스 타임스탬프로 해석

const pad2 = (n) => String(n).padStart(2, '0');

// 유닉스 타임스탬프(초 또는 밀리초) → Date | null
function fromUnix(n) {
  if (!Number.isFinite(n)) return null;
  const ms = Math.abs(n) >= MS_UNIX_THRESHOLD ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

const WEEKDAY = '일월화수목금토';

// 로컬 시각을 구성하되 유효성까지 검증한다(예: 6월 31일·13월·25시는 null).
function makeLocal(y, mo, d, h = 0, mi = 0, s = 0) {
  const dt = new Date(y, mo - 1, d, h, mi, s, 0);
  const ok =
    dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d &&
    dt.getHours() === h && dt.getMinutes() === mi && dt.getSeconds() === s;
  return ok ? dt : null;
}

/**
 * 다양한 입력을 Date로 정규화한다. 실패하면 null.
 * 허용: Date, 숫자(유닉스 초/밀리초), 숫자 문자열, ISO/로컬 datetime 문자열
 * ("2026-12-31T09:00", "2026-12-31 09:00", "2026-12-31T09:00:00Z" 등).
 * 타임존이 없는 문자열은 기기 로컬 시각으로 해석된다.
 */
export function parseTarget(input) {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input === 'number') return fromUnix(input);

  const s = String(input).trim();
  if (s === '') return null;
  if (/^-?\d+$/.test(s)) return fromUnix(Number(s)); // 순수 정수 → 유닉스 타임스탬프

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * target과 now(기본: 현재)의 차이.
 * @returns {{direction:'future'|'past'|'now', totalMs:number, days,hours,minutes,seconds:number}}
 *   direction: target이 미래면 'future'(남은 시간), 과거면 'past'(경과), 같으면 'now'.
 *   days~seconds: 부호 없는 절대 차이를 일·시·분·초로 분해.
 */
export function diff(target, now = new Date()) {
  const t = target instanceof Date ? target.getTime() : Number(target);
  const n = now instanceof Date ? now.getTime() : Number(now);
  const signed = t - n;
  const direction = signed > 0 ? 'future' : signed < 0 ? 'past' : 'now';

  const absMs = Math.abs(signed);
  const totalSeconds = Math.floor(absMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return { direction, totalMs: absMs, days, hours, minutes, seconds };
}

/** 분해된 차이를 "D일 HH:MM:SS"(일이 0이면 "HH:MM:SS")로 포맷. */
export function formatDuration({ days, hours, minutes, seconds }) {
  const hms = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return days > 0 ? `${days}일 ${hms}` : hms;
}

/** Date → "YYYY-MM-DD (요일) HH:MM:SS" (미리보기·확인용). */
export function formatLocal(date) {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `(${WEEKDAY[date.getDay()]}) ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/**
 * Beeftext 등에서 쓰는 다양한 사람 친화 형식을 Date로 파싱한다. 실패하면 null.
 * 시간 없는 입력은 00:00:00, 날짜 없는(시간만) 입력은 now의 날짜를 쓴다.
 * 지원 예:
 *   "2026-06-21 일 11:03:30" / "2026-06-21 11:03:32" / "2026-06-21T11:03:55"
 *   "2026-06-21 일" / "2026-06-21"
 *   "260621일110333" / "260621-110334" / "260621일" / "260621"
 *   "110338"(HHMMSS) / "11:03:41" / "11:03"
 *   10자리(초)·13자리(밀리초) 유닉스 타임스탬프
 * 모호한 6자리 숫자는 날짜(YYMMDD)를 우선 시도하고, 날짜로 무효하면 시간(HHMMSS)으로 해석한다.
 */
export function parseFlexible(input, now = new Date()) {
  if (input == null) return null;
  const s = String(input).trim();
  if (s === '') return null;

  const Y = now.getFullYear();
  const Mo = now.getMonth() + 1;
  const D = now.getDate();
  const wd = `[${WEEKDAY}]`;
  let m;

  // ISO: 2026-06-21T11:03[:55]
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/)))
    return makeLocal(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));

  // 풀 날짜(-구분) [요일] [시간]: 2026-06-21 [일] [11:03[:30]]
  if ((m = s.match(new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:\\s+${wd})?(?:\\s+(\\d{1,2}):(\\d{1,2})(?::(\\d{1,2}))?)?$`))))
    return makeLocal(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));

  // 8자리 날짜: 20260621 [요일] [-|공백] [110333]
  if ((m = s.match(new RegExp(`^(\\d{4})(\\d{2})(\\d{2})(?:${wd})?(?:[-\\s]?(\\d{2})(\\d{2})(\\d{2}))?$`)))) {
    const d = makeLocal(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    if (d) return d;
  }

  // 컴팩트 6자리 날짜: 260621 [요일] [-|공백] [110333]
  if ((m = s.match(new RegExp(`^(\\d{2})(\\d{2})(\\d{2})(?:${wd})?(?:[-\\s]?(\\d{2})(\\d{2})(\\d{2}))?$`)))) {
    const d = makeLocal(2000 + +m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    if (d) return d; // 날짜로 무효(예: 110338)면 아래 시간 해석으로 넘어감
  }

  // 시간만(HHMMSS): 110338 → 오늘 날짜
  if ((m = s.match(/^(\d{2})(\d{2})(\d{2})$/))) {
    const d = makeLocal(Y, Mo, D, +m[1], +m[2], +m[3]);
    if (d) return d;
  }

  // 시간만(HH:MM[:SS]): 11:03:41 / 11:03 → 오늘 날짜
  if ((m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/))) {
    const d = makeLocal(Y, Mo, D, +m[1], +m[2], +(m[3] ?? 0));
    if (d) return d;
  }

  // 유닉스 타임스탬프: 10자리(초) / 13자리(밀리초)
  if (/^\d{10}$/.test(s)) return fromUnix(+s);
  if (/^\d{13}$/.test(s)) return fromUnix(+s);

  return null;
}
