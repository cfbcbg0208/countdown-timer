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

/**
 * start→target 구간에서 now가 얼마나 진행됐는지 0~1로 반환(진행률 바/파이용).
 * 범위를 벗어나면 0 또는 1로 클램프. 구간이 0 이하(target<=start)면 now가 target 이상일 때 1, 아니면 0.
 * 인자는 Date·ISO문자열·ms 무엇이든 허용(new Date로 해석).
 */
export function elapsedFraction(start, target, now = Date.now()) {
  const s = new Date(start).getTime();
  const t = new Date(target).getTime();
  const n = new Date(now).getTime();
  if (Number.isNaN(s) || Number.isNaN(t) || Number.isNaN(n)) return 0;
  if (t <= s) return n >= t ? 1 : 0;
  return Math.min(1, Math.max(0, (n - s) / (t - s)));
}

/** Date → "YYYY-MM-DD 요일 HH:MM:SS" (미리보기·확인용). */
export function formatLocal(date) {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${WEEKDAY[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/**
 * 월 달력 그리드(일요일 시작). year/month0(0=1월)의 주[] 반환.
 * 각 주는 7일 {y, m(0-base), d, inMonth}. 앞뒤 달 날짜로 주를 꽉 채운다(4~6주).
 */
export function monthGrid(year, month0) {
  const startDow = new Date(year, month0, 1).getDay(); // 1일의 요일(0=일)
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;
  const weeks = [];
  for (let i = 0; i < totalCells; i++) {
    if (i % 7 === 0) weeks.push([]);
    const cur = new Date(year, month0, 1 - startDow + i);
    weeks[weeks.length - 1].push({
      y: cur.getFullYear(),
      m: cur.getMonth(),
      d: cur.getDate(),
      inMonth: cur.getMonth() === month0 && cur.getFullYear() === year,
    });
  }
  return weeks;
}

/** 항목의 기준(target=기준일시 | created=등록일시 | updated=수정일시)을 로컬 'YYYY-MM-DD'로. 없으면 null. */
export function dateKeyOf(item, basis = 'target') {
  const iso = basis === 'created' ? item.createdAt : basis === 'updated' ? item.updatedAt : item.targetISO;
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * 'd…' 기간(duration) 입력을 분해해 {years,months,days,hours,minutes,seconds}로 반환. 실패 시 null.
 * 대소문자 무관. 'd'/'D' 접두 필수. '지금부터 그만큼의 카운트다운' 추가용.
 * - 무단위 숫자: 자릿수로 해석 → 1~2자리=분, 3~4자리=HHMM, 5~6자리=HHMMSS (분·초는 ≤59 검증).
 *   예) d30=30분, d0530=5시간30분, d0400=4시간, d053000=5시간30분0초.
 * - 단위 접미: 초 s "  초 sec second(s) / 분 m ' 분 min minute(s) / 시 h 시 시간 hour(s) /
 *   일 d 일 day(s) / 월 mo month(s) 월 개월 / 년 y 년 year(s).
 *   ※ m/분/'·무단위 = '분', 월은 mo·month·월 로 명시(분과 월 충돌 회피).
 */
export function parseDuration(input) {
  if (input == null) return null;
  const m = String(input).trim().match(/^[dD]\s*(\d+)\s*(.*)$/);
  if (!m) return null;
  const digits = m[1];
  const n = parseInt(digits, 10);
  const unit = m[2].trim().toLowerCase();
  const z = { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

  if (unit === '') {
    if (digits.length <= 2) return { ...z, minutes: n };
    if (digits.length <= 4) {
      const mm = +digits.slice(-2);
      if (mm > 59) return null;
      return { ...z, hours: +digits.slice(0, -2), minutes: mm };
    }
    if (digits.length <= 6) {
      const ss = +digits.slice(-2);
      const mm = +digits.slice(-4, -2);
      if (mm > 59 || ss > 59) return null;
      return { ...z, hours: +digits.slice(0, -4), minutes: mm, seconds: ss };
    }
    return null;
  }
  if (['s', '"', '초', 'sec', 'secs', 'second', 'seconds'].includes(unit)) return { ...z, seconds: n };
  if (['m', "'", '분', 'min', 'mins', 'minute', 'minutes'].includes(unit)) return { ...z, minutes: n };
  if (['h', '시', '시간', 'hr', 'hrs', 'hour', 'hours'].includes(unit)) return { ...z, hours: n };
  if (['d', '일', 'day', 'days'].includes(unit)) return { ...z, days: n };
  if (['mo', 'month', 'months', '월', '개월'].includes(unit)) return { ...z, months: n };
  if (['y', '년', 'yr', 'yrs', 'year', 'years'].includes(unit)) return { ...z, years: n };
  return null;
}

// 기간(parseDuration 결과)을 기준 시각에 더한 새 Date. 시·분·초·일·월·년 모두 Date 정규화로 자리올림.
function applyDuration(now, dur) {
  const d = new Date(now);
  d.setFullYear(d.getFullYear() + dur.years);
  d.setMonth(d.getMonth() + dur.months);
  d.setDate(d.getDate() + dur.days);
  d.setHours(d.getHours() + dur.hours);
  d.setMinutes(d.getMinutes() + dur.minutes);
  d.setSeconds(d.getSeconds() + dur.seconds);
  return d;
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

  // 'd…' 기간 입력은 '지금부터 그만큼 뒤'로 해석(정규화 전에 먼저 가로챔).
  const dur = parseDuration(s);
  if (dur) return applyDuration(now, dur);

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
