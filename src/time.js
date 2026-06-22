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

// 시간 숫자덩어리(2/4/6자리) → [시, 분, 초]
function digitsToHMS(str) {
  return [+str.slice(0, 2), +(str.slice(2, 4) || 0), +(str.slice(4, 6) || 0)];
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

/** Date → "YYYY-MM-DD 요일 HH:MM:SS" (미리보기·확인용). */
export function formatLocal(date) {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${WEEKDAY[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/**
 * Beeftext 등에서 쓰는 사람 친화 형식 + 그 파생/변형들을 Date로 파싱한다. 실패하면 null.
 * 시간 없는 입력은 00:00:00, 날짜 없는(시간만) 입력은 now의 날짜를 쓴다.
 *
 * - 날짜 구분자: "-" "/" "." "년월일", 점·공백 혼합("2026. 6. 21.") 모두 허용. 연도는 4/2자리.
 * - 컴팩트(YYYYMMDD·YYMMDD) 뒤 시간은 2/4/6자리(HH·HHMM·HHMMSS), 구분자(- _ . T 공백)로 연결 가능.
 * - 시간: "11:03:30" "11:03" "110338" "1300" "11시 03분 30초" / 오전·오후(am·pm) 보정.
 * - 유닉스: 10자리(초)·13자리(밀리초). 6자리 숫자는 날짜(YYMMDD) 우선, 무효하면 시간(HHMMSS).
 */
export function parseFlexible(input, now = new Date()) {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === '') return null;

  const Y = now.getFullYear();
  const Mo = now.getMonth() + 1;
  const D = now.getDate();
  const ey = (y) => (y < 100 ? 2000 + y : y); // 2자리 연도 → 20xx

  // 오전/오후(am/pm) 추출 → 시(hour) 보정에 사용
  let ampm = null;
  const ap = s.match(/오전|오후|\b(?:am|pm)\b/i);
  if (ap) {
    ampm = /오후|pm/i.test(ap[0]) ? 'pm' : 'am';
    s = (s.slice(0, ap.index) + ' ' + s.slice(ap.index + ap[0].length)).trim();
  }
  const fixH = (h) => {
    if (ampm === 'pm' && h < 12) return h + 12;
    if (ampm === 'am' && h === 12) return 0;
    return h;
  };

  // 한국어·점·슬래시 구분자 정규화 → 표준 "YYYY-M-D" / "H:M:S" 로
  s = s
    .replace(/(\d{1,4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/, '$1-$2-$3')
    .replace(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/, `${Y}-$1-$2`)
    .replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분\s*(\d{1,2})\s*초?/, '$1:$2:$3')
    .replace(/(\d{1,2})\s*시\s*(\d{1,2})\s*분?/, '$1:$2')
    .replace(/(\d{1,2})\s*시/, '$1:00')
    .replace(/(\d{2,4})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{1,2})\.?/, '$1-$2-$3')
    .replace(/[일월화수목금토]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let m;

  // 대시 날짜(+시간): YYYY|YY - M - D  [(공백|T) H:M[:S]]
  if ((m = s.match(/^(\d{2,4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)))
    return makeLocal(ey(+m[1]), +m[2], +m[3], fixH(+(m[4] ?? 0)), +(m[5] ?? 0), +(m[6] ?? 0));

  // 8자리 컴팩트: YYYYMMDD [구분] [HH|HHMM|HHMMSS]
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:[-\s_.T\/]?(\d{2}(?:\d{2}){0,2}))?$/))) {
    const [h, mi, se] = m[4] ? digitsToHMS(m[4]) : [0, 0, 0];
    const d = makeLocal(+m[1], +m[2], +m[3], fixH(h), mi, se);
    if (d) return d;
  }

  // 6자리 컴팩트: YYMMDD [구분] [HH|HHMM|HHMMSS] (날짜로 무효하면 아래 시간 해석)
  if ((m = s.match(/^(\d{2})(\d{2})(\d{2})(?:[-\s_.T\/]?(\d{2}(?:\d{2}){0,2}))?$/))) {
    const [h, mi, se] = m[4] ? digitsToHMS(m[4]) : [0, 0, 0];
    const d = makeLocal(2000 + +m[1], +m[2], +m[3], fixH(h), mi, se);
    if (d) return d;
  }

  // 시간만(콜론): H:M[:S] → 오늘 날짜
  if ((m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/))) {
    const d = makeLocal(Y, Mo, D, fixH(+m[1]), +m[2], +(m[3] ?? 0));
    if (d) return d;
  }

  // 시간만(숫자 4/6자리): 1300 / 130011 → 오늘 날짜
  if ((m = s.match(/^(\d{4}|\d{6})$/))) {
    const [h, mi, se] = digitsToHMS(m[1]);
    const d = makeLocal(Y, Mo, D, fixH(h), mi, se);
    if (d) return d;
  }

  // 유닉스 타임스탬프: 10자리(초) / 13자리(밀리초)
  if (/^\d{10}$/.test(s)) return fromUnix(+s);
  if (/^\d{13}$/.test(s)) return fromUnix(+s);

  return null;
}
