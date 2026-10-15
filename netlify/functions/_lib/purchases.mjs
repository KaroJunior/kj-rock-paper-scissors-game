// Idempotent entitlement grants backed by Firestore.
// One grant per (playerId, purchaseId) — safe to call many times.
import { getDb } from './firebase.mjs';

const ENTITLEMENTS = 'vatar_entitlements';
const PLAYERS      = 'vatar_players';

/**
 * Idempotently grant an entitlement for a verified Vatar purchase.
 * Returns { granted: true } only on the first successful grant.
 * Never trusts anything except the params we pass in — those must already
 * have been verified against Vatar's API by the caller.
 */
export async function grantEntitlementOnce(playerId, productId, purchaseId) {
  const db = getDb();
  const docId = `${playerId}__${purchaseId}`;
  const ref = db.collection(ENTITLEMENTS).doc(docId);

  let granted = false;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) return;
    tx.set(ref, {
      playerId,
      productId,
      purchaseId,
      grantedAt: Date.now(),
    });
    granted = true;
  });

  // Mirror into a per-player doc for cheap entitlement restoration.
  const playerRef = db.collection(PLAYERS).doc(playerId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(playerRef);
    const prev = snap.exists ? (snap.data() || {}) : {};
    const ents = { ...(prev.entitlements || {}) };
    ents[productId] = true;
    tx.set(playerRef, {
      playerId,
      entitlements: ents,
      updatedAt: Date.now(),
    }, { merge: true });
  });

  return { granted };
}

export async function getEntitlements(playerId) {
  const db = getDb();
  const snap = await db.collection(PLAYERS).doc(playerId).get();
  if (!snap.exists) return {};
  return (snap.data() || {}).entitlements || {};
}