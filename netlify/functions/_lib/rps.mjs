// Pure Rock-Paper-Scissors rules. No I/O. Unit-tested.
import crypto from 'node:crypto';

export const CHOICES = Object.freeze(['rock', 'paper', 'scissors']);

// Ambiguity-free alphabet for share codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function isValidChoice(choice) {
  return typeof choice === 'string' && CHOICES.includes(choice);
}

export function isNonEmptyString(v, max = 64) {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/**
 * @returns {'tie'|'a'|'b'|null}  null if either side is invalid.
 */
export function determineWinner(a, b) {
  if (!isValidChoice(a) || !isValidChoice(b)) return null;
  if (a === b) return 'tie';
  if (
    (a === 'rock' && b === 'scissors') ||
    (a === 'paper' && b === 'rock') ||
    (a === 'scissors' && b === 'paper')
  ) {
    return 'a';
  }
  return 'b';
}

export function generateMatchCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export function generatePlayerId() {
  return 'p_' + crypto.randomBytes(8).toString('hex');
}

export function normalizeCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}