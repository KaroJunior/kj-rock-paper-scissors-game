// Pure helpers used by the frontend. No DOM, no network, no globals other than
// the ones we accept as arguments. Safe to import in tests.

export const PENDING_KEY   = 'kjrps.pendingChallenge.v1';
export const AUDIO_KEY     = 'kjrps.audio.v1';
export const CHALLENGE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const QUICK_THROTTLE_MS = 5_000;         // matches Vatar's documented 5s limit for create/quick

export function newPendingChallenge({ code, matchId = null, now = Date.now() }) {
  return { code, matchId, createdAt: now, expiresAt: now + CHALLENGE_TTL_MS };
}

export function isChallengeExpired(p, now = Date.now()) {
  if (!p || typeof p !== 'object') return true;
  if (typeof p.expiresAt !== 'number') return true;
  return now >= p.expiresAt;
}

export function isChallengeUsable(p, now = Date.now()) {
  if (!p) return false;
  if (typeof p.code !== 'string' || !p.code) return false;
  if (isChallengeExpired(p, now)) return false;
  return true;
}

export function remainingChallengeMs(p, now = Date.now()) {
  if (!isChallengeUsable(p, now)) return 0;
  return Math.max(0, p.expiresAt - now);
}

export function formatMmSs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function canSendQuickMatch({ busy, lastAt } = {}, now = Date.now()) {
  if (busy) return { ok: false, reason: 'busy' };
  if (lastAt && now - lastAt < QUICK_THROTTLE_MS) {
    return { ok: false, reason: 'too_soon', waitMs: QUICK_THROTTLE_MS - (now - lastAt) };
  }
  return { ok: true };
}

const RATE_LIMIT_CODES = new Set(['rate_limited', 'busy', 'too_soon']);
const RETRYABLE_CODES  = new Set(['error', 'timeout']);
const TERMINAL_CODES   = new Set([
  'not_available', 'not_framed', 'signed_out', 'not_for_sale',
  'off', 'not_multiplayer', 'friendly_only', 'limit',
  'not_found', 'not_open', 'bad_request',
]);

export function classifyError(code) {
  if (RATE_LIMIT_CODES.has(code)) return 'rate';
  if (RETRYABLE_CODES.has(code))  return 'retry';
  if (TERMINAL_CODES.has(code))   return 'terminal';
  return 'unknown';
}

export function messageForCode(code) {
  const messages = {
    rate_limited:   'Too many requests. Please wait a moment.',
    busy:           'A pay sheet or match is already open.',
    too_soon:       'Please wait a moment before trying again.',
    not_available:  'Multiplayer is not available in this game yet.',
    not_framed:     'Open this game inside Lagos Life to play multiplayer.',
    signed_out:     'You are signed out. Sign in and try again.',
    friendly_only:  'Only friendly matches are enabled right now.',
    limit:          'You have reached a matchmaking limit for today.',
    not_found:      'That match is no longer available.',
    not_open:       'That match has already started or is full.',
    not_multiplayer:'This game is not set up for multiplayer yet.',
    bad_request:    'Something was wrong with the request. Try again.',
    timeout:        'The request timed out. Try again.',
    error:          'Something went wrong. Try again in a moment.',
    cancelled:      'Cancelled.',
    payment_failed: 'Payment did not go through.',
    not_for_sale:   'That item is not for sale right now.',
    owned:          'You already own that item.',
    off:            'This game is currently turned off.',
  };
  return messages[code] || ('Error: ' + (code || 'unknown'));
}

export function defaultAudioPrefs() {
  return { sfx: true, music: false };
}

export function mergeAudioPrefs(stored) {
  const d = defaultAudioPrefs();
  if (!stored || typeof stored !== 'object') return d;
  return {
    sfx:   typeof stored.sfx   === 'boolean' ? stored.sfx   : d.sfx,
    music: typeof stored.music === 'boolean' ? stored.music : d.music,
  };
}

export function safeLocalGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function safeLocalSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export function safeLocalRemove(key) {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}
export function parseJsonSafe(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}