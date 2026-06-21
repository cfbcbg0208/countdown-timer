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
