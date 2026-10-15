// Thin wrapper around the Vatar SDK.
// Responsibilities: init once, cache a fresh session token, forward lifecycle & match
// updates, expose a match() namespace. Never fakes success.
//
// Design rule: the frontend is a THIN client. It does not decide winners.

export const vatar = {
  ready: false,
  mode: null,          // 'test' | 'live'
  player: null,
  error: null,
  _session: null,      // { session, exp }
  _unsubs: [],
  _onMatch: null,
  _onPause: null,
  _onResume: null,
};

function hasSdk() {
  return typeof window !== 'undefined' && typeof window.Vatar === 'object' && window.Vatar;
}

export async function initVatar({ onMatch, onPause, onResume } = {}) {
  vatar._onMatch = onMatch || null;
  vatar._onPause = onPause || null;
  vatar._onResume = onResume || null;

  if (!hasSdk()) { vatar.error = 'not_framed'; return vatar; }

  try {
    const info = await window.Vatar.init(); // { player, session, mode }
    vatar.ready  = true;
    vatar.player = info.player || null;
    vatar.mode   = info.mode || null;
    vatar._session = { session: info.session, exp: Date.now() + 14 * 60 * 1000 };

    vatar._unsubs.push(window.Vatar.onPause(() => vatar._onPause && vatar._onPause()));
    vatar._unsubs.push(window.Vatar.onResume(() => vatar._onResume && vatar._onResume()));

    if (window.Vatar.match && typeof window.Vatar.match.onUpdate === 'function') {
      vatar._unsubs.push(window.Vatar.match.onUpdate((m) => vatar._onMatch && vatar._onMatch(m)));
    }
  } catch (e) {
    vatar.error = (e && e.code) || (e && e.message) || 'init_failed';
    // eslint-disable-next-line no-console
    console.warn('[vatar] init failed:', vatar.error);
  }
  return vatar;
}

export async function getSession() {
  if (!vatar.ready) throw new Error('vatar_not_ready');
  const now = Date.now();
  if (!vatar._session || vatar._session.exp - now < 2 * 60 * 1000) {
    const { session, exp } = await window.Vatar.session();
    vatar._session = { session, exp: exp || (now + 14 * 60 * 1000) };
  }
  return vatar._session.session;
}

export function matchApi() {
  if (!vatar.ready || !window.Vatar.match) throw new Error('matches_unavailable');
  return window.Vatar.match;
}