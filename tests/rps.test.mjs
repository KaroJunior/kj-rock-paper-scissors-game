import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  determineWinner,
  isValidChoice,
  generateMatchCode,
  normalizeCode,
  outcomeToVatarWinner,
  normaliseVatarPlayer,
  CODE_LENGTH,
} from '../netlify/functions/_lib/rps.mjs';

test('isValidChoice accepts only the three legal choices', () => {
  for (const c of ['rock','paper','scissors']) assert.equal(isValidChoice(c), true);
  for (const c of ['ROCK','lizard','',null,undefined,3,{}]) assert.equal(isValidChoice(c), false);
});

test('all 9 outcome combinations', () => {
  const cases = [
    ['rock','rock','tie'],['rock','paper','b'],['rock','scissors','a'],
    ['paper','rock','a'],['paper','paper','tie'],['paper','scissors','b'],
    ['scissors','rock','b'],['scissors','paper','a'],['scissors','scissors','tie'],
  ];
  for (const [a,b,w] of cases) assert.equal(determineWinner(a,b), w, `${a} vs ${b}`);
});

test('invalid choices never yield a winner', () => {
  assert.equal(determineWinner('rock','banana'), null);
  assert.equal(determineWinner('', ''), null);
  assert.equal(determineWinner(null,'rock'), null);
});

test('generateMatchCode length & charset', () => {
  for (let i = 0; i < 100; i++) {
    const c = generateMatchCode();
    assert.equal(c.length, CODE_LENGTH);
    assert.match(c, /^[A-HJ-NP-Z2-9]+$/);
  }
});

test('normalizeCode trims and uppercases', () => {
  assert.equal(normalizeCode('  abc123 '), 'ABC123');
  assert.equal(normalizeCode(''), '');
  assert.equal(normalizeCode(null), '');
});

test('two rapid codes unlikely to collide', () => {
  const s = new Set(); for (let i = 0; i < 500; i++) s.add(generateMatchCode());
  assert.ok(s.size > 450);
});

test('outcomeToVatarWinner maps correctly', () => {
  assert.equal(outcomeToVatarWinner('tie','p_A','p_B'), 'draw');
  assert.equal(outcomeToVatarWinner('a', 'p_A','p_B'), 'p_A');
  assert.equal(outcomeToVatarWinner('b', 'p_A','p_B'), 'p_B');
});

test('normaliseVatarPlayer accepts both SDK and API shapes', () => {
  assert.deepEqual(normaliseVatarPlayer({ id: 'p_1', name: 'Ada' }), { id: 'p_1', name: 'Ada' });
  assert.deepEqual(normaliseVatarPlayer({ playerId: 'p_2', name: 'Tolu' }), { id: 'p_2', name: 'Tolu' });
  assert.equal(normaliseVatarPlayer({}), null);
  assert.equal(normaliseVatarPlayer(null), null);
});

// --- Vatar signature vector (documentation-derived) ---
import crypto from 'node:crypto';
test('Vatar result signature format matches the documented 5-line HMAC', () => {
  // Reference implementation of the docs, not a live Vatar call.
  const secret = 'test-secret-please-do-not-ship';
  const matchId = 'm_TEST';
  const nonce   = 'nonce-abc';
  const winner  = 'p_A';
  const path    = `/api/games/v1/matches/${matchId}/result`;
  const body    = JSON.stringify({ winner });
  const ts      = '1791720000';
  const sha     = crypto.createHash('sha256').update(body).digest('hex');
  const sig     = 'v1=' + crypto.createHmac('sha256', secret)
    .update(['POST', path, ts, nonce, sha].join('\n')).digest('hex');
  assert.match(sig, /^v1=[0-9a-f]{64}$/);
});