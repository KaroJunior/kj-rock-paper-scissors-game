// All game API endpoints live here.
// Route prefix: /api/*
//   POST /api/match/create            -> { code, token, playerId }
//   POST /api/match/join   { code }   -> { code, token, playerId }
//   GET  /api/match/:code             -> match state (filtered)
//   POST /api/match/:code/choice { choice }
//   POST /api/match/:code/leave
//
// The frontend never touches Firestore directly.
// All mutations go through Firestore transactions so simultaneous requests are safe.

import { getDb } from './_lib/firebase.mjs';
import { signToken, requirePlayer } from './_lib/auth.mjs';
import {
  isValidChoice,
  determineWinner,
  generateMatchCode,
  generatePlayerId,
  normalizeCode,
  isNonEmptyString,
} from './_lib/rps.mjs';

const REVEAL_MS = 5000;          // how long a completed round stays visible before the next one starts
const WAITING_TTL_MS = 1000 * 60 * 30; // abandoned waiting games become joinable again after 30 min
const STALE_PLAYER_MS = 1000 * 60;     // a player is considered stale after 60s of silence

// ---------- helpers ----------

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function badRequest(message) {
  return json({ error: message }, 400);
}

function unauthorized() {
  return json({ error: 'unauthorized' }, 401);
}

function notFound(message = 'not found') {
  return json({ error: message }, 404);
}

function conflict(message) {
  return json({ error: message }, 409);
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Take an internal match document and produce the *filtered* view
// that a specific player is allowed to see.
function publicMatchView(match, playerId) {
  const isHost = match.hostId === playerId;
  const opponentId = isHost ? match.guestId : match.hostId;

  const youAre = isHost ? 'host' : 'guest';
  const currentRound = match.rounds[match.currentRound - 1] || null;

  let roundView = null;
  if (currentRound) {
    const youSubmitted = !!currentRound.submitted?.[playerId];
    const opponentSubmitted = opponentId ? !!currentRound.submitted?.[opponentId] : false;
    const roundComplete = currentRound.status === 'complete';

    let yourChoice = null;
    let opponentChoice = null;
    let result = null;

    if (roundComplete) {
      yourChoice = currentRound.choices?.[playerId] ?? null;
      opponentChoice = opponentId ? currentRound.choices?.[opponentId] ?? null : null;
      const winner = currentRound.winner;
      if (winner === 'tie') result = 'tie';
      else if (winner === playerId) result = 'win';
      else if (winner) result = 'lose';
    } else if (youSubmitted) {
      // We allow the player to see their own choice before the round completes,
      // but not the opponent's. This lets the UI show "you picked X, waiting...".
      yourChoice = currentRound.choices?.[playerId] ?? null;
    }

    roundView = {
      number: currentRound.number,
      status: currentRound.status, // 'open' | 'complete'
      youSubmitted,
      opponentSubmitted,
      yourChoice,
      opponentChoice,
      result,
      completedAt: currentRound.completedAt || null,
    };
  }

  const history = match.rounds
    .filter((r) => r.status === 'complete')
    .map((r) => {
      const yourC = r.choices?.[playerId] ?? null;
      const oppC = opponentId ? r.choices?.[opponentId] ?? null : null;
      let res = null;
      if (r.winner === 'tie') res = 'tie';
      else if (r.winner === playerId) res = 'win';
      else if (r.winner) res = 'lose';
      return { number: r.number, yourChoice: yourC, opponentChoice: oppC, result: res };
    });

  return {
    code: match.code,
    status: match.status,
    youAre,
    you: { id: playerId, score: match.scores?.[playerId] ?? 0 },
    opponent: opponentId
      ? { id: opponentId, score: match.scores?.[opponentId] ?? 0 }
      : null,
    round: roundView,
    history,
  };
}

// ---------- match lifecycle ----------

async function createMatch() {
  const db = getDb();
  const playerId = generatePlayerId();

  // Retry a few times in case we happen to hit an existing code.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateMatchCode();
    const ref = db.collection('matches').doc(code);

    const created = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;

      const now = Date.now();
      tx.set(ref, {
        code,
        hostId: playerId,
        guestId: null,
        status: 'waiting',
        createdAt: now,
        updatedAt: now,
        lastSeen: { [playerId]: now },
        scores: { [playerId]: 0 },
        currentRound: 1,
        rounds: [
          {
            number: 1,
            status: 'open',
            submitted: {},
            choices: {},
            winner: null,
            completedAt: null,
          },
        ],
      });
      return true;
    });

    if (created) {
      const token = signToken({ code, playerId });
      return json({ code, token, playerId });
    }
  }

  return json({ error: 'could not allocate a unique match code' }, 500);
}

async function joinMatch(req) {
  const body = await readJson(req);
  const code = normalizeCode(body?.code);
  if (!code) return badRequest('missing game code');

  const db = getDb();
  const ref = db.collection('matches').doc(code);
  const playerId = generatePlayerId();

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: 'match_not_found' };

    const match = snap.data();
    const now = Date.now();

    if (match.hostId === playerId) return { error: 'cannot_join_own_match' };

    // Match already has a guest.
    if (match.guestId) return { error: 'match_full' };

    // If the host has been silent for a long time and status is still 'waiting',
    // we still allow joining — this keeps abandoned codes usable rather than
    // permanently locked. If status is 'active' or 'ended', refuse.
    if (match.status === 'ended') return { error: 'match_ended' };
    if (match.status === 'active') return { error: 'match_full' };

    tx.update(ref, {
      guestId: playerId,
      status: 'active',
      updatedAt: now,
      [`lastSeen.${playerId}`]: now,
      [`scores.${playerId}`]: 0,
    });

    return { ok: true };
  });

  if (outcome.error === 'match_not_found') return notFound('match not found');
  if (outcome.error === 'match_full') return conflict('match is full');
  if (outcome.error === 'match_ended') return conflict('match has ended');
  if (outcome.error) return conflict(outcome.error);

  const token = signToken({ code, playerId });
  return json({ code, token, playerId });
}

async function getMatch(req, claims) {
  const db = getDb();
  const ref = db.collection('matches').doc(claims.code);

  // Periodic bookkeeping: update lastSeen and possibly auto-advance a completed round.
  // We do this in a transaction so two concurrent GETs (host+guest) are safe.
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const match = snap.data();

    const update = { [`lastSeen.${claims.playerId}`]: now, updatedAt: now };

    // Auto-advance if a completed round has been shown for REVEAL_MS.
    const current = match.rounds[match.currentRound - 1];
    if (
      current &&
      current.status === 'complete' &&
      current.completedAt &&
      now - current.completedAt >= REVEAL_MS
    ) {
      const nextNumber = match.currentRound + 1;
      update.currentRound = nextNumber;
      update.rounds = [
        ...match.rounds,
        {
          number: nextNumber,
          status: 'open',
          submitted: {},
          choices: {},
          winner: null,
          completedAt: null,
        },
      ];
    }

    tx.update(ref, update);
  });

  const snap = await ref.get();
  if (!snap.exists) return notFound('match not found');
  const match = snap.data();

  // Authorization: caller must be one of the two players.
  if (match.hostId !== claims.playerId && match.guestId !== claims.playerId) {
    return unauthorized();
  }

  return json(publicMatchView(match, claims.playerId));
}

async function submitChoice(req, claims) {
  const body = await readJson(req);
  const choice = body?.choice;
  if (!isValidChoice(choice)) return badRequest('invalid choice');

  const db = getDb();
  const ref = db.collection('matches').doc(claims.code);

  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: 'match_not_found' };
    const match = snap.data();

    if (match.hostId !== claims.playerId && match.guestId !== claims.playerId) {
      return { error: 'unauthorized' };
    }
    if (match.status !== 'active') return { error: 'match_not_active' };

    const roundIdx = match.currentRound - 1;
    const round = match.rounds[roundIdx];
    if (!round) return { error: 'round_missing' };
    if (round.status !== 'open') return { error: 'round_closed' };
    if (round.submitted?.[claims.playerId]) return { error: 'already_submitted' };

    const newSubmitted = { ...(round.submitted || {}), [claims.playerId]: true };
    const newChoices = { ...(round.choices || {}), [claims.playerId]: choice };

    const participants = [match.hostId, match.guestId].filter(Boolean);
    const bothSubmitted = participants.every((p) => newSubmitted[p]);

    let newRound = { ...round, submitted: newSubmitted, choices: newChoices };

    if (bothSubmitted) {
      const aId = match.hostId;
      const bId = match.guestId;
      const aChoice = newChoices[aId];
      const bChoice = newChoices[bId];
      const result = determineWinner(aChoice, bChoice);

      let winnerId = null;
      if (result === 'tie') winnerId = 'tie';
      else if (result === 'a') winnerId = aId;
      else if (result === 'b') winnerId = bId;

      newRound.status = 'complete';
      newRound.winner = winnerId;
      newRound.completedAt = Date.now();

      const newScores = { ...(match.scores || {}) };
      if (winnerId && winnerId !== 'tie') {
        newScores[winnerId] = (newScores[winnerId] || 0) + 1;
      }

      const newRounds = [...match.rounds];
      newRounds[roundIdx] = newRound;

      tx.update(ref, {
        rounds: newRounds,
        scores: newScores,
        updatedAt: Date.now(),
      });
    } else {
      const newRounds = [...match.rounds];
      newRounds[roundIdx] = newRound;
      tx.update(ref, { rounds: newRounds, updatedAt: Date.now() });
    }

    return { ok: true };
  });

  switch (outcome.error) {
    case undefined: return json({ ok: true });
    case 'match_not_found': return notFound('match not found');
    case 'unauthorized': return unauthorized();
    case 'match_not_active': return conflict('match is not active');
    case 'round_missing': return conflict('round missing');
    case 'round_closed': return conflict('round is closed');
    case 'already_submitted': return conflict('already submitted this round');
    default: return conflict(outcome.error || 'could not submit');
  }
}

async function leaveMatch(req, claims) {
  const db = getDb();
  const ref = db.collection('matches').doc(claims.code);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const match = snap.data();
    if (match.hostId !== claims.playerId && match.guestId !== claims.playerId) return;

    const now = Date.now();
    tx.update(ref, {
      status: 'ended',
      updatedAt: now,
      [`lastSeen.${claims.playerId}`]: now,
      leftBy: claims.playerId,
    });
  });

  return json({ ok: true });
}

// ---------- router ----------

async function route(req) {
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean); // ['api','match',...]
  if (parts[0] !== 'api') return notFound();
  const method = req.method.toUpperCase();

  // /api/match/create
  if (parts[1] === 'match' && parts[2] === 'create' && method === 'POST') {
    return createMatch();
  }
  // /api/match/join
  if (parts[1] === 'match' && parts[2] === 'join' && method === 'POST') {
    return joinMatch(req);
  }

  // /api/match/:code(/choice|/leave)
  if (parts[1] === 'match' && parts[2]) {
    const claims = requirePlayer(req);
    if (!claims) return unauthorized();
    if (claims.code !== normalizeCode(parts[2])) return unauthorized();

    if (parts.length === 3 && method === 'GET') {
      return getMatch(req, claims);
    }
    if (parts.length === 4 && parts[3] === 'choice' && method === 'POST') {
      return submitChoice(req, claims);
    }
    if (parts.length === 4 && parts[3] === 'leave' && method === 'POST') {
      return leaveMatch(req, claims);
    }
  }

  return notFound();
}

export default async (req) => {
  try {
    return await route(req);
  } catch (err) {
    console.error('api error', err);
    return json({ error: 'server_error' }, 500);
  }
};

export const config = {
  path: '/api/*',
};