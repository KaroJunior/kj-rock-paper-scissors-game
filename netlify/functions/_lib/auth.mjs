// Signed, stateless player tokens. HMAC-SHA256 over a small JSON payload.
// This is NOT general user auth; it only proves "this request is the same player
// who created/joined this specific match". Vatar will replace this later.
import crypto from 'node:crypto';

function getSecret() {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('TOKEN_SECRET is missing or too short.');
  }
  return secret;
}

export function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;

  let expected;
  try {
    expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  } catch {
    return null;
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function getBearer(req) {
  const header = req.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

export function requirePlayer(req) {
  const token = getBearer(req);
  const claims = verifyToken(token);
  if (!claims || typeof claims.code !== 'string' || typeof claims.playerId !== 'string') {
    return null;
  }
  return claims; // { code, playerId }
}