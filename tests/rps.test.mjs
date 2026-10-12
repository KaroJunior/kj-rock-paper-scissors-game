import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  determineWinner,
  isValidChoice,
  generateMatchCode,
  normalizeCode,
  CODE_LENGTH,
} from '../netlify/functions/_lib/rps.mjs';

test('isValidChoice accepts only the three legal choices', () => {
  assert.equal(isValidChoice('rock'), true);
  assert.equal(isValidChoice('paper'), true);
  assert.equal(isValidChoice('scissors'), true);
  assert.equal(isValidChoice('ROCK'), false);
  assert.equal(isValidChoice('lizard'), false);
  assert.equal(isValidChoice(''), false);
  assert.equal(isValidChoice(null), false);
  assert.equal(isValidChoice(undefined), false);
  assert.equal(isValidChoice(3), false);
});

test('all 9 outcome combinations are correct', () => {
  const cases = [
    ['rock',     'rock',     'tie'],
    ['rock',     'paper',    'b'],
    ['rock',     'scissors', 'a'],
    ['paper',    'rock',     'a'],
    ['paper',    'paper',    'tie'],
    ['paper',    'scissors', 'b'],
    ['scissors', 'rock',     'b'],
    ['scissors', 'paper',    'a'],
    ['scissors', 'scissors', 'tie'],
  ];
  for (const [a, b, expected] of cases) {
    assert.equal(determineWinner(a, b), expected, `${a} vs ${b}`);
  }
});

test('invalid choices never yield a winner', () => {
  assert.equal(determineWinner('rock', 'banana'), null);
  assert.equal(determineWinner('banana', 'rock'), null);
  assert.equal(determineWinner('', ''), null);
  assert.equal(determineWinner(null, 'rock'), null);
});

test('generateMatchCode produces the right length & charset', () => {
  for (let i = 0; i < 100; i++) {
    const code = generateMatchCode();
    assert.equal(code.length, CODE_LENGTH);
    assert.match(code, /^[A-HJ-NP-Z2-9]+$/);
  }
});

test('normalizeCode trims and uppercases', () => {
  assert.equal(normalizeCode('  abc123 '), 'ABC123');
  assert.equal(normalizeCode(''), '');
  assert.equal(normalizeCode(null), '');
});

test('two rapid codes are unlikely to collide', () => {
  const set = new Set();
  for (let i = 0; i < 500; i++) set.add(generateMatchCode());
  // Statistical sanity — not a uniqueness guarantee, but collisions here
  // would indicate a broken generator.
  assert.ok(set.size > 450, `only ${set.size} unique codes out of 500`);
});