import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlexible, formatLocal } from '../src/time.js';

// 시간만/날짜만 입력의 기본값 검증을 위해 now를 고정한다.
const NOW = new Date(2026, 5, 21, 9, 30, 15); // 2026-06-21(일) 09:30:15

const eq = (input, y, mo, d, h = 0, mi = 0, s = 0) =>
  assert.equal(
    parseFlexible(input, NOW)?.getTime(),
    new Date(y, mo - 1, d, h, mi, s).getTime(),
    `입력 "${input}"`,
  );

test('풀 날짜 + 요일 + 시간', () => eq('2026-06-21 일 11:03:30', 2026, 6, 21, 11, 3, 30));
test('풀 날짜 + 시간', () => eq('2026-06-21 11:03:32', 2026, 6, 21, 11, 3, 32));
test('ISO T', () => eq('2026-06-21T11:03:55', 2026, 6, 21, 11, 3, 55));
test('풀 날짜 + 요일 (시간 없음 → 00:00:00)', () => eq('2026-06-21 일', 2026, 6, 21));
test('풀 날짜만', () => eq('2026-06-21', 2026, 6, 21));

test('컴팩트 YYMMDD일HHMMSS', () => eq('260621일110333', 2026, 6, 21, 11, 3, 33));
test('컴팩트 YYMMDD-HHMMSS', () => eq('260621-110334', 2026, 6, 21, 11, 3, 34));
test('컴팩트 YYMMDD일 (시간 없음)', () => eq('260621일', 2026, 6, 21));
test('컴팩트 YYMMDD (6자리 → 날짜 우선)', () => eq('260621', 2026, 6, 21));

test('시간만 HHMMSS → 오늘 날짜', () => eq('110338', 2026, 6, 21, 11, 3, 38));
test('시간만 HH:MM:SS → 오늘 날짜', () => eq('11:03:41', 2026, 6, 21, 11, 3, 41));
test('시간만 HH:MM → 오늘 날짜, 초=0', () => eq('11:03', 2026, 6, 21, 11, 3, 0));

test('8자리 YYYYMMDD', () => eq('20260621', 2026, 6, 21));

test('유닉스 초(10자리)', () =>
  assert.equal(parseFlexible('1700000000', NOW).getTime(), 1700000000 * 1000));
test('유닉스 밀리초(13자리)', () =>
  assert.equal(parseFlexible('1700000000000', NOW).getTime(), 1700000000000));

test('인식 불가 → null', () => {
  for (const bad of ['1', '안녕', '', '   ', '2026-13-01', '260631', '99:99'])
    assert.equal(parseFlexible(bad, NOW), null, `"${bad}"`);
});

test('formatLocal: 요일 포함 표기', () => {
  assert.equal(formatLocal(new Date(2026, 5, 21, 11, 3, 33)), '2026-06-21 (일) 11:03:33');
});
