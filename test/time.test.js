import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, diff, formatDuration, elapsedFraction } from '../src/time.js';

test('parseTarget: 로컬 datetime 문자열을 기기 로컬 시각으로 해석', () => {
  const d = parseTarget('2026-12-31T09:00');
  assert.equal(d.getTime(), new Date(2026, 11, 31, 9, 0, 0, 0).getTime());
});

test('parseTarget: 공백 구분 문자열도 허용', () => {
  const d = parseTarget('2026-12-31 09:00');
  assert.equal(d.getTime(), new Date(2026, 11, 31, 9, 0, 0, 0).getTime());
});

test('parseTarget: 유닉스 초', () => {
  assert.equal(parseTarget(1700000000).getTime(), 1700000000 * 1000);
});

test('parseTarget: 유닉스 밀리초', () => {
  assert.equal(parseTarget(1700000000000).getTime(), 1700000000000);
});

test('parseTarget: 숫자 문자열도 유닉스 타임스탬프로', () => {
  assert.equal(parseTarget('1700000000').getTime(), 1700000000 * 1000);
});

test('parseTarget: 잘못된 입력 → null', () => {
  assert.equal(parseTarget('내일쯤'), null);
  assert.equal(parseTarget(''), null);
  assert.equal(parseTarget('   '), null);
  assert.equal(parseTarget(null), null);
  assert.equal(parseTarget(undefined), null);
});

test('diff: 미래 → direction future, 정확한 분해', () => {
  const now = new Date(2026, 0, 1, 0, 0, 0);
  const delta = ((1 * 24 + 2) * 60 + 3) * 60 + 4; // 1일 2:03:04
  const target = new Date(now.getTime() + delta * 1000);
  const r = diff(target, now);
  assert.equal(r.direction, 'future');
  assert.deepEqual(
    { days: r.days, hours: r.hours, minutes: r.minutes, seconds: r.seconds },
    { days: 1, hours: 2, minutes: 3, seconds: 4 },
  );
});

test('diff: 과거 → direction past, 절대 차이로 분해', () => {
  const now = new Date(2026, 0, 1, 0, 0, 0);
  const delta = ((3 * 24 + 0) * 60 + 30) * 60 + 15; // 3일 0:30:15
  const target = new Date(now.getTime() - delta * 1000);
  const r = diff(target, now);
  assert.equal(r.direction, 'past');
  assert.deepEqual(
    { days: r.days, hours: r.hours, minutes: r.minutes, seconds: r.seconds },
    { days: 3, hours: 0, minutes: 30, seconds: 15 },
  );
});

test('diff: 같은 시각 → direction now, 모두 0', () => {
  const now = new Date(2026, 0, 1, 0, 0, 0);
  const r = diff(new Date(now.getTime()), now);
  assert.equal(r.direction, 'now');
  assert.deepEqual(
    { days: r.days, hours: r.hours, minutes: r.minutes, seconds: r.seconds },
    { days: 0, hours: 0, minutes: 0, seconds: 0 },
  );
});

test('formatDuration: 일이 0이면 HH:MM:SS', () => {
  assert.equal(formatDuration({ days: 0, hours: 3, minutes: 4, seconds: 5 }), '03:04:05');
});

test('formatDuration: 일이 있으면 "D일 HH:MM:SS"', () => {
  assert.equal(formatDuration({ days: 12, hours: 3, minutes: 4, seconds: 5 }), '12일 03:04:05');
});

test('elapsedFraction: 중간 지점은 0.5', () => {
  const s = new Date(2026, 0, 1, 0, 0, 0);
  const t = new Date(2026, 0, 11, 0, 0, 0); // 10일 구간
  const mid = new Date(2026, 0, 6, 0, 0, 0); // 5일 경과
  assert.equal(elapsedFraction(s, t, mid), 0.5);
});

test('elapsedFraction: 시작 전·도달 후는 0·1로 클램프', () => {
  const s = new Date(2026, 0, 1).getTime();
  const t = new Date(2026, 0, 11).getTime();
  assert.equal(elapsedFraction(s, t, new Date(2025, 11, 20)), 0); // 시작 전
  assert.equal(elapsedFraction(s, t, new Date(2026, 1, 1)), 1); // 한참 지남
  assert.equal(elapsedFraction(s, t, s), 0); // 정확히 시작
  assert.equal(elapsedFraction(s, t, t), 1); // 정확히 도달
});

test('elapsedFraction: 구간 0 이하/잘못된 입력 안전 처리', () => {
  const s = new Date(2026, 0, 10).getTime();
  assert.equal(elapsedFraction(s, s, s), 1); // target<=start, now>=target
  assert.equal(elapsedFraction(s, s, s - 1000), 0); // target<=start, now<target
  assert.equal(elapsedFraction('bad', '2026-01-01', Date.now()), 0); // NaN → 0
});

test('elapsedFraction: ISO 문자열도 허용', () => {
  assert.equal(
    elapsedFraction('2026-01-01T00:00:00', '2026-01-03T00:00:00', '2026-01-02T00:00:00'),
    0.5,
  );
});
