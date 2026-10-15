// /api/* routes:
//   POST /api/session/exchange       { session }         -> backend token
//   POST /api/match/register         { vatarMatchId }    -> filtered match view
//   POST /api/match/:id/choice       { choice }          -> { ok, resolved, vatar }
//   GET  /api/match/:id                                  -> filtered match view
//   POST /api/purchase/claim         { purchaseId }      -> { ok, granted, ... }
//   GET  /api/purchase/entitlements                      -> { entitlements }
import { issueToken, requirePlayer } from './_lib/auth.mjs';
import { isValidChoice, determineWinner, normaliseVatarPlayer } from './_lib/rps.mjs';
import * as Vatar from './_lib/vatar.mjs';
import {
  ensureMatch, getMatch as getLocalMatch,
  submitChoice, tryResolve, recordVatarResult,
} from './_lib/matches.mjs';
import { grantEntitlementOnce, getEntitlements } from './_lib/purchases.mjs';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const err  = (msg, status = 400) => json({ error: msg }, status);
const unauth = () => err('unauthorized', 401);
const nf   = (m = 'not found') => err(m, 404);
const conflict = (m) => err(m, 409);

async function readBody(req) { try { return await req.json(); } catch { return null; } }

function filteredView(m, meId) {
  const opp = m.players.find((p) => p.id !== meId) || null;
  const youSubmitted = !!m.submitted[meId];
  const oppSubmitted = opp ? !!m.submitted[opp.id] : false;
  const resolved = m.status === 'resolved';
  return {
    matchId: m.matchId,
    code: m.code,
    stake: m.stake,
    mode: m.mode,
    status: m.status,
    you: { id: meId, name: m.players.find((p) => p.id === meId)?.name || null },
    opponent: opp ? { id: opp.id, name: opp.name } : null,
    round: m.round,
    yourChoice:     resolved || youSubmitted ? (m.choices[meId] || null) : null,
    opponentChoice: resolved && opp ? (m.choices[opp.id] || null) : null,
    youSubmitted,
    opponentSubmitted: oppSubmitted,
    winner: resolved ? (m.winner === meId ? 'you' : m.winner === 'draw' ? 'draw' : 'opponent') : null,
    deadline: m.deadline,
    startedAt: m.startedAt,
  };
}

// ---------- endpoints ----------

async function exchangeSession(req) {
  const b = await readBody(req);
  if (typeof b?.session !== 'string' || !b.session) return err('missing session');

  const r = await Vatar.verifySession(b.session);
  if (r.http === 401) return unauth();
  if (!r.ok) return json({ error: 'vatar_error', http: r.http }, 502);

  const { playerId, name, mode } = r.data || {};
  if (typeof playerId !== 'string' || !playerId) return json({ error: 'vatar_bad_response' }, 502);

  const token = issueToken({ playerId, name: name || null, mode: mode || 'test' });
  return json({ token, playerId, name: name || null, mode: mode || 'test' });
}

async function registerMatch(req, claims) {
  const b = await readBody(req);
  if (typeof b?.vatarMatchId !== 'string' || !b.vatarMatchId) return err('missing vatarMatchId');

  const r = await Vatar.getMatch(b.vatarMatchId);
  if (!r.ok) return json({ error: 'vatar_error', http: r.http, detail: r.data }, 502);

  const v = r.data || {};
  if (v.status !== 'playing' && v.status !== 'open') return conflict(`match_${v.status}`);

  const players = (v.players || []).map(normaliseVatarPlayer).filter(Boolean);
  if (!players.some((p) => p.id === claims.playerId)) return unauth();
  if (!v.nonce) return json({ error: 'vatar_missing_nonce' }, 502);

  const local = await ensureMatch({
    id: v.id, code: v.code, nonce: v.nonce,
    players, stake: v.stake, mode: v.mode,
  });
  return json(filteredView(local, claims.playerId));
}

async function doChoice(req, claims, matchId) {
  const b = await readBody(req);
  if (!isValidChoice(b?.choice)) return err('invalid choice');

  const local = await getLocalMatch(matchId);
  if (!local) return nf('match not found');
  if (!local.players.some((p) => p.id === claims.playerId)) return unauth();
  if (local.status === 'resolved') return conflict('already resolved');

  const res = await submitChoice(matchId, claims.playerId, b.choice);
  if (!res.ok) {
    const map = {
      not_found: [404, 'match not found'],
      already_resolved: [409, 'already resolved'],
      not_a_player: [401, 'unauthorized'],
      already_submitted: [409, 'already submitted'],
      past_deadline: [409, 'past deadline'],
    };
    const [code, msg] = map[res.reason] || [409, res.reason];
    return err(msg, code);
  }

  const outcome = await tryResolve(matchId, determineWinner);
  if (outcome.resolved) {
    const post = await Vatar.postMatchResult(matchId, outcome.finalState.nonce, outcome.finalState.winner);
    await recordVatarResult(matchId, post);
    return json({ ok: true, resolved: true, vatar: { http: post.http, ok: post.ok, attempts: post.attempts } });
  }
  return json({ ok: true, resolved: false });
}

async function getState(_req, claims, matchId) {
  let local = await getLocalMatch(matchId);
  if (!local) return nf('match not found');
  if (!local.players.some((p) => p.id === claims.playerId)) return unauth();

  if (local.status === 'active' && Date.now() > local.deadline) {
    const outcome = await tryResolve(matchId, determineWinner);
    if (outcome.resolved) {
      const post = await Vatar.postMatchResult(matchId, outcome.finalState.nonce, outcome.finalState.winner);
      await recordVatarResult(matchId, post);
    }
    local = await getLocalMatch(matchId);
  }

  return json(filteredView(local, claims.playerId));
}

// ---------- purchases ----------

async function claimPurchase(req, claims) {
  const b = await readBody(req);
  if (typeof b?.purchaseId !== 'string' || !b.purchaseId) return err('missing purchaseId');
  if (b.purchaseId.length > 128) return err('bad purchaseId');

  // 1. Ask Vatar. Client claims are never trusted.
  const r = await Vatar.getPurchase(b.purchaseId);
  if (!r.ok) {
    if (r.http === 404) return nf('purchase not found');
    return json({ error: 'vatar_error', http: r.http }, 502);
  }
  const p = r.data || {};

  // 2. Must belong to this player.
  if (p.playerId !== claims.playerId) return err('not your purchase', 403);

  // 3. Status gate.
  if (p.status === 'refunded') return err('refunded', 409);
  if (p.status !== 'paid' && p.status !== 'delivered') return err('not paid', 409);

  // 4. Idempotent grant.
  const { granted } = await grantEntitlementOnce(claims.playerId, p.productId, p.id);

  // 5. Mark delivered (safe to repeat). A refunded purchase is 409 — treat as failure.
  let delivered = { ok: true, http: 200 };
  if (p.status !== 'delivered') {
    delivered = await Vatar.deliverPurchase(p.id);
  }

  return json({
    ok: true,
    granted,
    productId: p.productId,
    vatarStatus: p.status,
    delivered: delivered.ok,
    deliveredHttp: delivered.http,
  });
}

async function listEntitlements(_req, claims) {
  const ents = await getEntitlements(claims.playerId);
  return json({ entitlements: ents });
}

// ---------- router ----------
async function route(req) {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean); // [ 'api', ... ]
  if (parts[0] !== 'api') return nf();
  const method = req.method.toUpperCase();

  if (parts[1] === 'session' && parts[2] === 'exchange' && method === 'POST') return exchangeSession(req);

  if (parts[1] === 'match' && parts[2] === 'register' && method === 'POST') {
    const claims = requirePlayer(req); if (!claims) return unauth();
    return registerMatch(req, claims);
  }
  if (parts[1] === 'match' && parts[2] && parts[2] !== 'register') {
    const claims = requirePlayer(req); if (!claims) return unauth();
    const matchId = parts[2];
    if (parts.length === 3 && method === 'GET') return getState(req, claims, matchId);
    if (parts.length === 4 && parts[3] === 'choice' && method === 'POST') return doChoice(req, claims, matchId);
  }

  if (parts[1] === 'purchase' && parts[2] === 'claim' && method === 'POST') {
    const claims = requirePlayer(req); if (!claims) return unauth();
    return claimPurchase(req, claims);
  }
  if (parts[1] === 'purchase' && parts[2] === 'entitlements' && method === 'GET') {
    const claims = requirePlayer(req); if (!claims) return unauth();
    return listEntitlements(req, claims);
  }

  return nf();
}

export default async (req) => {
  try { return await route(req); }
  catch (e) { console.error('api error', e && e.stack || e); return json({ error: 'server_error' }, 500); }
};

export const config = { path: '/api/*' };