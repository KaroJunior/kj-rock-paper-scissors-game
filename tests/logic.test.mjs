import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGE_TTL_MS, QUICK_THROTTLE_MS,
  newPendingChallenge, isChallengeExpired, isChallengeUsable,
  remainingChallengeMs, formatMmSs,
  canSendQuickMatch, classifyError, messageForCode,
  defaultAudioPrefs, mergeAudioPrefs, parseJsonSafe,
} from '../logic.mjs';

test('newPendingChallenge sets a 10-minute expiry', () => {
  const now = 1_000_000;
  const p = newPendingChallenge({ code: 'ABC123', matchId: 'm_1', now });
  assert.equal(p.code, 'ABC123');
  assert.equal(p.matchId, 'm_1');
  assert.equal(p.createdAt, now);
  assert.equal(p.expiresAt, now + CHALLENGE_TTL_MS);
  assert.equal(CHALLENGE_TTL_MS, 10 * 60 * 1000);
});

test('isChallengeUsable rejects expired, missing, malformed', () => {
  const now = 1_000_000;
  const good = newPendingChallenge({ code: 'ABC123', now });
  assert.equal(isChallengeUsable(good, now), true);
  assert.equal(isChallengeUsable(good, now + CHALLENGE_TTL_MS), false);
  assert.equal(isChallengeUsable(good, now + CHALLENGE_TTL_MS + 1), false);
  assert.equal(isChallengeUsable(null, now), false);
  assert.equal(isChallengeUsable({ code: '' }, now), false);
  assert.equal(isChallengeUsable({ code: 'ABC' }, now), false);
});

test('isChallengeExpired distinguishes valid vs missing', () => {
  const now = 500;
  assert.equal(isChallengeExpired(null, now), true);
  assert.equal(isChallengeExpired({ expiresAt: now + 1 }, now), false);
  assert.equal(isChallengeExpired({ expiresAt: now }, now), true);
  assert.equal(isChallengeExpired({ expiresAt: 'nope' }, now), true);
});

test('remainingChallengeMs clamps to zero', () => {
  const now = 1_000;
  const p = newPendingChallenge({ code: 'X', now });
  assert.equal(remainingChallengeMs(p, now), CHALLENGE_TTL_MS);
  assert.equal(remainingChallengeMs(p, now + CHALLENGE_TTL_MS + 10_000), 0);
  assert.equal(remainingChallengeMs(null, now), 0);
});

test('formatMmSs formats minutes and seconds', () => {
  assert.equal(formatMmSs(0), '0:00');
  assert.equal(formatMmSs(1000), '0:01');
  assert.equal(formatMmSs(60_000), '1:00');
  assert.equal(formatMmSs(10 * 60_000), '10:00');
  assert.equal(formatMmSs(9 * 60_000 + 5_000), '9:05');
  assert.equal(formatMmSs(-5000), '0:00');
});

test('canSendQuickMatch throttles within 5 s and while busy', () => {
  const now = 1_000_000;
  assert.equal(canSendQuickMatch({ busy: false, lastAt: 0 }, now).ok, true);
  assert.equal(canSendQuickMatch({ busy: true, lastAt: 0 }, now).ok, false);
  const r = canSendQuickMatch({ busy: false, lastAt: now - 1000 }, now);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too_soon');
  assert.equal(r.waitMs, QUICK_THROTTLE_MS - 1000);
  assert.equal(canSendQuickMatch({ busy: false, lastAt: now - QUICK_THROTTLE_MS }, now).ok, true);
});

test('classifyError categorises SDK codes', () => {
  assert.equal(classifyError('rate_limited'), 'rate');
  assert.equal(classifyError('busy'), 'rate');
  assert.equal(classifyError('too_soon'), 'rate');
  assert.equal(classifyError('error'), 'retry');
  assert.equal(classifyError('timeout'), 'retry');
  assert.equal(classifyError('not_available'), 'terminal');
  assert.equal(classifyError('not_framed'), 'terminal');
  assert.equal(classifyError('signed_out'), 'terminal');
  assert.equal(classifyError('cancelled'), 'unknown');
});

test('messageForCode always returns a non-empty string', () => {
  for (const code of ['rate_limited','busy','too_soon','not_available','not_framed','signed_out','not_found','owned','error','made_up_code_xyz']) {
    const m = messageForCode(code);
    assert.equal(typeof m, 'string');
    assert.ok(m.length > 0);
  }
});

test('defaultAudioPrefs and mergeAudioPrefs are safe', () => {
  const d = defaultAudioPrefs();
  assert.deepEqual(d, { sfx: true, music: false });
  assert.deepEqual(mergeAudioPrefs(null), d);
  assert.deepEqual(mergeAudioPrefs('garbage'), d);
  assert.deepEqual(mergeAudioPrefs({ sfx: false }), { sfx: false, music: false });
  assert.deepEqual(mergeAudioPrefs({ music: true }), { sfx: true, music: true });
  assert.deepEqual(mergeAudioPrefs({ sfx: 'yes', music: 1 }), d); // wrong types fall back
});

test('parseJsonSafe is safe', () => {
  assert.equal(parseJsonSafe(''), null);
  assert.equal(parseJsonSafe(null), null);
  assert.equal(parseJsonSafe('{bad'), null);
  assert.deepEqual(parseJsonSafe('{"a":1}'), { a: 1 });
});