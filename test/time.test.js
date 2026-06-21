import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, diff, formatDuration } from '../src/time.js';

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
