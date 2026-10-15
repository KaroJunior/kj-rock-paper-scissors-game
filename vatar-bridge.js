// Thin wrapper around the Vatar SDK.
// Responsibilities: init once, cache a fresh session token, forward lifecycle & match
// updates, expose match() and purchase helpers. Never fakes success.
//
// Design rule: the frontend is a THIN client. It does not decide winners,
// and it does not decide whether a purchase was paid.

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
  vatar._onMatch  = onMatch  || null;
  vatar._onPause  = onPause  || null;
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

// ---------- Purchases ----------

export function purchasesSupported() {
  return !!(vatar.ready && window.Vatar
    && typeof window.Vatar.purchase === 'function'
    && typeof window.Vatar.purchases === 'function'
    && typeof window.Vatar.onPurchase === 'function');
}

/** Ask Vatar to open the pay sheet. Resolves { purchaseId, productId } or throws. */
export async function requestPurchase(productId) {
  if (!purchasesSupported()) {
    const e = new Error('purchases_unavailable');
    e.code = 'not_available';
    throw e;
  }
  return window.Vatar.purchase(productId);
}

/** Paid purchases in this game not yet marked delivered by our server. */
export async function listUndeliveredPurchases() {
  if (!purchasesSupported()) return [];
  try { return await window.Vatar.purchases(); } catch { return []; }
}

/** Subscribe to purchases confirmed while no purchase() call was waiting. */
export function onVatarPurchase(fn) {
  if (!purchasesSupported()) return () => {};
  const unsub = window.Vatar.onPurchase(fn);
  vatar._unsubs.push(unsub);
  return unsub;
}

/** Test helper. */
export function _resetVatarForTests() {
  vatar.ready = false; vatar.mode = null; vatar.player = null; vatar.error = null;
  vatar._session = null; vatar._unsubs = [];
}