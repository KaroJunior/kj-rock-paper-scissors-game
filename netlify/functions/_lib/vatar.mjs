// Server-side client for the Vatar Games API (v1).
// Base: https://lagoslife.app/api/games/v1
// Auth: Authorization: Bearer $VATAR_SECRET
// Result signing: HMAC-SHA256 over 5 lines with $VATAR_RESULTS_SECRET
//   method \n path \n timestamp \n nonce \n hex(SHA256(body))
import crypto from 'node:crypto';

const BASE = process.env.VATAR_API_BASE || 'https://lagoslife.app/api/games/v1';

const secret        = () => mustEnv('VATAR_SECRET');
const resultsSecret = () => mustEnv('VATAR_RESULTS_SECRET');
const webhookSecret = () => mustEnv('VATAR_WEBHOOK_SECRET');
function mustEnv(k) { const v = process.env[k]; if (!v) throw new Error(k + ' is not set'); return v; }

async function call(method, path, { body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* keep */ }
  return { ok: res.ok, http: res.status, data, text };
}

export async function verifySession(session) {
  return call('POST', '/session/verify', { body: { session } });
}
export async function getMatch(matchId) {
  return call('GET', `/matches/${encodeURIComponent(matchId)}`);
}

/** Sign and POST a match result. Retries on 5xx with exponential backoff. */
export async function postMatchResult(matchId, nonce, winner, { maxAttempts = 3 } = {}) {
  const path = `/api/games/v1/matches/${matchId}/result`;
  const body = JSON.stringify({ winner });
  const sha = crypto.createHash('sha256').update(body).digest('hex');

  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ts  = String(Math.floor(Date.now() / 1000));
    const sig = 'v1=' + crypto.createHmac('sha256', resultsSecret())
      .update(['POST', path, ts, nonce, sha].join('\n')).digest('hex');

    const res = await fetch(new URL(path, 'https://lagoslife.app'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret()}`,
        'Content-Type': 'application/json',
        'X-Vatar-Timestamp': ts,
        'X-Vatar-Signature': sig,
      },
      body,
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* keep */ }
    last = { ok: res.ok, http: res.status, data, text, attempts: attempt };

    if (res.ok) return last;
    if (res.status >= 400 && res.status < 500 && res.status !== 401) return last;
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
  }
  return last;
}

/** GET /purchases/{id} — one purchase in this game. */
export async function getPurchase(purchaseId) {
  return call('GET', `/purchases/${encodeURIComponent(purchaseId)}`);
}

/** POST /purchases/{id}/deliver — safe to repeat. */
export async function deliverPurchase(purchaseId) {
  return call('POST', `/purchases/${encodeURIComponent(purchaseId)}/deliver`);
}

/** Constant-time verification of a webhook signature: "sha256=" + hex HMAC of raw body. */
export function verifyWebhook(rawBodyString, headerValue) {
  const want = Buffer.from(
    'sha256=' + crypto.createHmac('sha256', webhookSecret()).update(rawBodyString).digest('hex')
  );
  const got = Buffer.from(String(headerValue || ''));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}