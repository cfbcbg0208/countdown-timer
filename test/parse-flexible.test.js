import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlexible, formatLocal, parseDuration } from '../src/time.js';

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

test('formatLocal: 요일 포함 표기(괄호 없음)', () => {
  assert.equal(formatLocal(new Date(2026, 5, 21, 11, 3, 33)), '2026-06-21 일 11:03:33');
});

// ── parseDuration: 'd…' 기간 해석 ──
const Z = { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

test('parseDuration 무단위: 자릿수 규칙(분/HHMM/HHMMSS)', () => {
  assert.deepEqual(parseDuration('d30'), { ...Z, minutes: 30 }); // 2자리=분
  assert.deepEqual(parseDuration('d5'), { ...Z, minutes: 5 });
  assert.deepEqual(parseDuration('d0530'), { ...Z, hours: 5, minutes: 30 }); // 4자리=HHMM
  assert.deepEqual(parseDuration('d0400'), { ...Z, hours: 4, minutes: 0 });
  assert.deepEqual(parseDuration('d530'), { ...Z, hours: 5, minutes: 30 }); // 3자리=HMM
  assert.deepEqual(parseDuration('d053000'), { ...Z, hours: 5, minutes: 30, seconds: 0 }); // 6자리
  assert.equal(parseDuration('d0560'), null); // 분 60 → 무효
});

test('한영 IME 자모 보정: ㅇ0500=d0500, ㅇ2ㅗ=d2h 등 의도대로 해석', () => {
  // parseFlexible는 자모를 형식 글자로 되돌린 뒤 해석한다(now+기간).
  const eq = (a, b) => assert.equal(parseFlexible(a, NOW).getTime(), parseFlexible(b, NOW).getTime(), `${a} == ${b}`);
  eq('ㅇ0500', 'd0500'); // d→ㅇ
  eq('ㅇ30', 'd30');
  eq('ㅇ2ㅗ', 'd2h'); // h→ㅗ
  eq('ㅇ30ㄴ', 'd30s'); // s→ㄴ
  eq('ㅇ30ㅡ', 'd30m'); // m→ㅡ
  eq('ㅇ30ㅡㅐ', 'd30mo'); // mo(월)
});

test('parseDuration 단위: 초/분/시/일/월/년', () => {
  for (const s of ['d30s', 'd30"', 'd30초', 'd30sec', 'd30seconds'])
    assert.deepEqual(parseDuration(s), { ...Z, seconds: 30 }, s);
  for (const s of ['d30m', "d30'", 'd30분', 'd30min', 'd30minutes'])
    assert.deepEqual(parseDuration(s), { ...Z, minutes: 30 }, s);
  for (const s of ['d30h', 'd30시', 'd30시간', 'd30hours'])
    assert.deepEqual(parseDuration(s), { ...Z, hours: 30 }, s);
  for (const s of ['d30d', 'd30일', 'd30days'])
    assert.deepEqual(parseDuration(s), { ...Z, days: 30 }, s);
  for (const s of ['d30mo', 'd30month', 'd30월'])
    assert.deepEqual(parseDuration(s), { ...Z, months: 30 }, s);
  for (const s of ['d30y', 'd30년', 'd30years'])
    assert.deepEqual(parseDuration(s), { ...Z, years: 30 }, s);
});

test('parseDuration: 대소문자 무관, 무효 입력은 null', () => {
  assert.deepEqual(parseDuration('D30M'), { ...Z, minutes: 30 });
  assert.deepEqual(parseDuration('D30H'), { ...Z, hours: 30 });
  for (const s of ['d', 'd30x', '30', 'abc', '', 'dm']) assert.equal(parseDuration(s), null, s);
});

test('parseFlexible: d… 는 now 기준 미래로', () => {
  const now = new Date(2026, 5, 21, 9, 0, 0);
  assert.equal(parseFlexible('d30', now).getTime(), new Date(2026, 5, 21, 9, 30, 0).getTime());
  assert.equal(parseFlexible('d0530', now).getTime(), new Date(2026, 5, 21, 14, 30, 0).getTime());
  assert.equal(parseFlexible('d2h', now).getTime(), new Date(2026, 5, 21, 11, 0, 0).getTime());
  assert.equal(parseFlexible('d1일', now).getTime(), new Date(2026, 5, 22, 9, 0, 0).getTime());
});
