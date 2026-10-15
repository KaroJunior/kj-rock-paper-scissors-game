// Webhook receiver for Vatar events.
// Verifies the signature; logs the envelope. Never trusts webhook bodies for state changes.
import { verifyWebhook } from './_lib/vatar.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await req.text();
  const sig = req.headers.get('x-vatar-signature');
  const evt = req.headers.get('x-vatar-event') || 'unknown';

  let ok = false;
  try { ok = verifyWebhook(raw, sig); } catch (e) { console.error('webhook check failed:', e && e.message); }
  if (!ok) return new Response('invalid signature', { status: 401 });

  let envelope = null; try { envelope = JSON.parse(raw); } catch { /* ignore */ }
  const id = envelope?.id || 'unknown';
  console.log(`vatar webhook received event=${evt} id=${id}`);

  return new Response('ok', { status: 200 });
};

export const config = { path: '/api/vatar/webhook' };