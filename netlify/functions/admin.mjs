// GET /admin/stats — Basic-Auth-protected JSON with aggregate counts.
// Deliberately read-only and does not expose any player-identifying information
// beyond anonymous match codes.
import crypto from 'node:crypto';
import { getDb } from './_lib/firebase.mjs';

function constantTimeEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function checkAuth(req) {
  const expectedUser = process.env.ADMIN_USER;
  const expectedPass = process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPass) return false;

  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return false;

  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return constantTimeEq(user, expectedUser) && constantTimeEq(pass, expectedPass);
}

async function computeStats() {
  const db = getDb();
  const snap = await db.collection('matches').get();

  let total = 0;
  let waiting = 0;
  let active = 0;
  let ended = 0;
  let roundsCompleted = 0;
  const since = Date.now() - 24 * 60 * 60 * 1000;
  let last24h = 0;

  snap.forEach((doc) => {
    const m = doc.data();
    total++;
    if (m.status === 'waiting') waiting++;
    else if (m.status === 'active') active++;
    else if (m.status === 'ended') ended++;
    if (m.createdAt && m.createdAt >= since) last24h++;
    if (Array.isArray(m.rounds)) {
      roundsCompleted += m.rounds.filter((r) => r.status === 'complete').length;
    }
  });

  return {
    generatedAt: new Date().toISOString(),
    matches: { total, waiting, active, ended },
    roundsCompleted,
    matchesLast24h: last24h,
  };
}

export default async (req) => {
  if (req.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!checkAuth(req)) {
    return new Response('auth required', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="admin", charset="UTF-8"' },
    });
  }
  try {
    const stats = await computeStats();
    return new Response(JSON.stringify(stats, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (err) {
    console.error('admin error', err);
    return new Response(JSON.stringify({ error: 'server_error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
};

export const config = {
  path: '/admin/stats',
};