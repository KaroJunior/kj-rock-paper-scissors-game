// Signed, stateless tokens.
// Player payload: { playerId, name, mode, exp }
// Admin payload:  { role: 'admin', exp }
import crypto from 'node:crypto';

const PLAYER_TTL_MS = 30 * 60 * 1000;
const ADMIN_TTL_MS  = 60 * 60 * 1000;

function getSecret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 16) throw new Error('TOKEN_SECRET is missing or too short.');
  return s;
}
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig  = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}
function verify(token) {
  if (typeof token !== 'string') return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!p || typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

// ----- Player tokens -----
export function issueToken({ playerId, name, mode }) {
  return sign({ playerId, name, mode, exp: Date.now() + PLAYER_TTL_MS });
}
export function requirePlayer(req) {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const p = verify(header.slice(7));
  return (p && typeof p.playerId === 'string') ? p : null;
}

// ----- Admin tokens -----
export function issueAdminToken() {
  return sign({ role: 'admin', exp: Date.now() + ADMIN_TTL_MS });
}
export function requireAdminFromCookie(req) {
  const cookie = parseCookies(req.headers.get('cookie') || '');
  const p = verify(cookie['rps_admin'] || '');
  return (p && p.role === 'admin') ? p : null;
}
export const ADMIN_COOKIE = 'rps_admin';
export const ADMIN_COOKIE_MAX_AGE = Math.floor(ADMIN_TTL_MS / 1000);

// ----- Cookie parsing -----
export function parseCookies(header) {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// ----- CSRF -----
// Double-submit cookie: we set a random token in a non-HttpOnly cookie and require the
// same value in a form field. Combined with SameSite=Strict on the session cookie,
// this gives adequate CSRF protection on an admin read-only dashboard.
export function newCsrfToken() {
  return crypto.randomBytes(24).toString('base64url');
}
export function csrfMatches(req, body) {
  const cookie = parseCookies(req.headers.get('cookie') || '');
  const a = cookie['rps_csrf'] || '';
  const b = (body && body.csrf) || '';
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}