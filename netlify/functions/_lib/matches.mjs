// Firestore-backed state for a Vatar match.
// Vatar is authoritative for wallet, stake, pot, payout. We only track gameplay state.
import { getDb } from './firebase.mjs';

const COL = 'vatar_matches';

// Turn window. Player has this long from the moment the match was registered.
// Add a startup grace so the second player has time to load.
export const TURN_MS   = Number(process.env.TURN_MS || 20_000);
export const STARTUP_GRACE_MS = 10_000;

export async function ensureMatch(vatarMatch) {
  const db = getDb();
  const ref = db.collection(COL).doc(vatarMatch.id);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      tx.update(ref, { lastSeenAt: now });
      return;
    }
    tx.set(ref, {
      matchId: vatarMatch.id,
      code: vatarMatch.code,
      nonce: vatarMatch.nonce,
      players: vatarMatch.players,
      stake: vatarMatch.stake,
      mode: vatarMatch.mode,
      status: 'active',                     // 'active' | 'resolved' | 'failed'
      round: 1,
      submitted: {},
      choices: {},
      winner: null,
      startedAt: now,
      deadline: now + TURN_MS + STARTUP_GRACE_MS,
      resolvedAt: null,
      lastSeenAt: now,
      vatarResult: null,
    });
  });

  const snap = await ref.get();
  return snap.data();
}

export async function getMatch(matchId) {
  const db = getDb();
  const snap = await db.collection(COL).doc(matchId).get();
  return snap.exists ? snap.data() : null;
}

/** Lock in a player's choice. Idempotent refusal if already submitted. */
export async function submitChoice(matchId, playerId, choice) {
  const db = getDb();
  const ref = db.collection(COL).doc(matchId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: 'not_found' };
    const m = snap.data();
    if (m.status !== 'active') return { ok: false, reason: 'already_resolved' };
    if (!m.players.some((p) => p.id === playerId)) return { ok: false, reason: 'not_a_player' };
    if (m.submitted[playerId]) return { ok: false, reason: 'already_submitted' };
    if (Date.now() > m.deadline) return { ok: false, reason: 'past_deadline' };

    tx.update(ref, {
      submitted: { ...m.submitted, [playerId]: true },
      choices:   { ...m.choices,   [playerId]: choice },
      lastSeenAt: Date.now(),
    });
    return { ok: true };
  });
}

/**
 * Try to resolve the round. Idempotent.
 * - If both submitted: normal RPS resolution.
 * - If deadline passed: whoever submitted wins; nobody submitted = draw.
 */
export async function tryResolve(matchId, determineWinner) {
  const db = getDb();
  const ref = db.collection(COL).doc(matchId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { resolved: false, reason: 'not_found' };
    const m = snap.data();
    if (m.status !== 'active') return { resolved: false, reason: 'already_resolved' };

    const allIn = m.players.every((p) => m.submitted[p.id]);
    const pastDeadline = Date.now() > m.deadline;
    if (!allIn && !pastDeadline) return { resolved: false, reason: 'not_ready' };

    let winner;
    if (allIn) {
      const [a, b] = m.players.map((p) => p.id);
      const outcome = determineWinner(m.choices[a], m.choices[b]);
      winner = outcome === 'tie' ? 'draw' : outcome === 'a' ? a : b;
    } else {
      const submitted = m.players.filter((p) => m.submitted[p.id]);
      winner = submitted.length === 1 ? submitted[0].id : 'draw';
    }

    const resolvedAt = Date.now();
    tx.update(ref, { status: 'resolved', winner, resolvedAt });
    return { resolved: true, finalState: { ...m, status: 'resolved', winner, resolvedAt } };
  });
}

export async function recordVatarResult(matchId, vatarResult) {
  const db = getDb();
  await db.collection(COL).doc(matchId).update({
    vatarResult: vatarResult.data || { http: vatarResult.http, ok: vatarResult.ok, attempts: vatarResult.attempts },
  });
}