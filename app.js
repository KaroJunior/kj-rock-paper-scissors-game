// Frontend for Karo Junior RPS.
// Single-player runs locally. Multiplayer talks to our backend at /api/*;
// the backend talks to Vatar. The browser never sees Vatar secrets.

import { initVatar, getSession, vatar, matchApi,
  requestPurchase, listUndeliveredPurchases, onVatarPurchase,
  purchasesSupported } from './vatar-bridge.js';
import * as Audio from './audio.js';
import {
  PENDING_KEY, AUDIO_KEY, CHALLENGE_TTL_MS,
  newPendingChallenge, isChallengeUsable, isChallengeExpired,
  remainingChallengeMs, formatMmSs,
  canSendQuickMatch, classifyError, messageForCode,
  defaultAudioPrefs, mergeAudioPrefs,
  safeLocalGet, safeLocalSet, safeLocalRemove, parseJsonSafe,
} from './logic.mjs';

// ---- Vatar product ID -------------------------------------------------------
// Create this product in the Vatar dashboard with this exact ID, name it
// "Neon Arena Theme", price it (₦100–₦50,000, one-off cosmetic), mark it for
// sale, then paste the same ID here. If the dashboard forces a different ID,
// change this constant to match — nothing else in the code needs to change.
export const NEON_ARENA_PRODUCT_ID = 'neon_arena';
const NEON_THEME_CLASS = 'theme-neon';

// In-game logos. The Neon Arena theme swaps to the neon mark.
const LOGO_DEFAULT = '/assets/logo.png';
const LOGO_NEON    = '/assets/logo2.png';

// ---------- state ----------
const S = {
  screen: 'menu',
  spYou: 0, spCpu: 0,
  token: null, playerId: null,
  current: null,
  local: null,
  pollTimer: null,
  countdownTimer: null,
  challengeTimer: null,
  lastRound: 0,
  stake: 0,
  quickBusy: false,
  quickLastAt: 0,
  quickState: 'idle',
  pendingChallenge: null,
  entitlements: {},
  audioPrefs: defaultAudioPrefs(),
  audioUnlocked: false,
};

// ---------- dom helpers ----------
const $ = (id) => document.getElementById(id);
const setText = (id, t) => { const el = $(id); if (el) el.textContent = t; };
const show = (id, on) => { const el = $(id); if (el) el.hidden = !on; };

// ---------- emoji ----------
const emoji = (c) => c === 'rock' ? '✊' : c === 'paper' ? '✋' : c === 'scissors' ? '✌️' : '?';

// ---------- safe audio wrapper ----------
function playSound(name, arg) {
  try {
    if (name === 'choice')  Audio.playChoice(arg);
    if (name === 'confirm') Audio.playConfirm();
    if (name === 'win')     Audio.playWin();
    if (name === 'lose')    Audio.playLose();
    if (name === 'draw')    Audio.playDraw();
    if (name === 'found')   Audio.playMatchFound();
  } catch { /* never let audio break gameplay */ }
}

function ensureAudioUnlocked() {
  if (S.audioUnlocked) return;
  S.audioUnlocked = true;
  try { Audio.applyPrefs(S.audioPrefs); Audio.unlock(); } catch {}
}

function refreshAudioToggles() {
  const sfx = $('sfx-toggle');
  const mus = $('music-toggle');
  if (sfx) {
    sfx.setAttribute('aria-pressed', S.audioPrefs.sfx ? 'true' : 'false');
    sfx.classList.toggle('is-on', S.audioPrefs.sfx);
  }
  if (mus) {
    mus.setAttribute('aria-pressed', S.audioPrefs.music ? 'true' : 'false');
    mus.classList.toggle('is-on', S.audioPrefs.music);
  }
}

function saveAudioPrefs() {
  safeLocalSet(AUDIO_KEY, JSON.stringify(S.audioPrefs));
}
function loadAudioPrefs() {
  S.audioPrefs = mergeAudioPrefs(parseJsonSafe(safeLocalGet(AUDIO_KEY)));
}

// ---------- navigation ----------
function goto(screen) {
  S.screen = screen;
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.screen === screen);
  });
  if (screen === 'mp') refreshMpAvailability();
}

// ---------- single player ----------
function playSP(choice) {
  ensureAudioUnlocked();
  playSound('choice', choice);
  const CPU = ['rock','paper','scissors'];
  const cpu = CPU[Math.floor(Math.random()*3)];
  const p1 = $('sp-p1');
  p1.classList.add('shake');
  setTimeout(() => {
    p1.classList.remove('shake');
    p1.classList.add('pop');
    setText('sp-p1', emoji(choice));
    setText('sp-p2', emoji(cpu));
    setTimeout(() => p1.classList.remove('pop'), 350);

    let text, cls;
    if (choice === cpu) { text = "Tie."; cls = 'res-t'; playSound('draw'); }
    else if (
      (choice === 'rock' && cpu === 'scissors') ||
      (choice === 'paper'  && cpu === 'rock') ||
      (choice === 'scissors' && cpu === 'paper')
    ) { text = 'You win!'; S.spYou++; cls = 'res-w'; playSound('win'); }
    else { text = 'CPU wins.'; S.spCpu++; cls = 'res-l'; playSound('lose'); }

    setText('sp-you', String(S.spYou));
    setText('sp-cpu', String(S.spCpu));
    setText('sp-verdict', text);
    addTape('sp-tape', `You ${emoji(choice)} · CPU ${emoji(cpu)}`, text, cls);
  }, 320);
}

function addTape(id, text, result, cls) {
  const tape = $(id);
  const row = document.createElement('div');
  row.className = 'row';
  const left = document.createElement('span'); left.textContent = text;
  const right = document.createElement('span'); right.className = cls || ''; right.textContent = result;
  row.append(left, right);
  tape.prepend(row);
  while (tape.children.length > 5) tape.removeChild(tape.lastChild);
}

// ---------- backend api ----------
async function rawApi(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && S.token) headers.authorization = `Bearer ${S.token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* keep */ }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

async function api(path, opts = {}) {
  try {
    return await rawApi(path, opts);
  } catch (e) {
    if (e.status === 401 && opts.auth !== false) {
      S.token = null;
      try { await ensureBackendSession(); } catch { throw e; }
      return rawApi(path, opts);
    }
    throw e;
  }
}

async function ensureBackendSession() {
  if (S.token) return;
  const session = await getSession();
  const r = await api('/api/session/exchange', { method: 'POST', body: { session }, auth: false });
  S.token = r.token;
  S.playerId = r.playerId;
  setText('whoami', (r.name || 'Player') + ' · ' + r.mode);
}

// ---------- multiplayer availability ----------
function refreshMpAvailability() {
  show('mp-offline', !vatar.ready);
  show('mp-lobby', vatar.ready);
  const badge = $('env-badge');
  if (vatar.ready) {
    badge.dataset.mode = vatar.mode || 'test';
    badge.textContent = (vatar.mode || 'test').toUpperCase();
  } else {
    badge.textContent = 'STANDALONE';
  }
  setText('mp-mode-hint', S.stake > 0 ? `Staked · ${S.stake}` : 'Friendly');
  renderChallengePending();
  renderNeonStatus();
}

// ---------- challenge persistence ----------
function loadPendingChallenge() {
  const raw = safeLocalGet(PENDING_KEY);
  const parsed = parseJsonSafe(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.code !== 'string' || !parsed.code) return null;
  if (typeof parsed.createdAt !== 'number' || typeof parsed.expiresAt !== 'number') return null;
  return parsed;
}
function savePendingChallenge(p) {
  if (!p) { safeLocalRemove(PENDING_KEY); return; }
  safeLocalSet(PENDING_KEY, JSON.stringify(p));
}
function clearPendingChallenge() {
  S.pendingChallenge = null;
  savePendingChallenge(null);
  stopChallengeTimer();
}

function renderChallengePending() {
  const box = $('mp-challenge-pending');
  if (!box) return;
  const p = S.pendingChallenge;
  const usable = isChallengeUsable(p);
  if (!usable) { box.hidden = true; return; }
  box.hidden = false;
  setText('mp-code-display', p.code);
  startChallengeTimer();
}

function startChallengeTimer() {
  stopChallengeTimer();
  const tick = () => {
    const p = S.pendingChallenge;
    if (!isChallengeUsable(p)) {
      stopChallengeTimer();
      renderChallengePending();
      return;
    }
    const left = remainingChallengeMs(p);
    const pct = Math.max(0, Math.min(1, left / CHALLENGE_TTL_MS));
    const fill = $('mp-challenge-timer-fill');
    if (fill) fill.style.width = (pct * 100).toFixed(1) + '%';
    setText('mp-challenge-timer-text', formatMmSs(left));
  };
  tick();
  S.challengeTimer = setInterval(tick, 500);
}
function stopChallengeTimer() {
  if (S.challengeTimer) { clearInterval(S.challengeTimer); S.challengeTimer = null; }
}

async function reconcilePendingChallenge({ silent = false } = {}) {
  const cached = loadPendingChallenge();
  if (!cached) { S.pendingChallenge = null; return { state: 'none' }; }
  S.pendingChallenge = cached;

  if (!vatar.ready) {
    if (isChallengeExpired(cached)) { clearPendingChallenge(); return { state: 'expired_offline' }; }
    return { state: 'offline_cached' };
  }

  let current = null;
  try { current = await matchApi().current(); } catch { current = null; }

  if (!current) {
    clearPendingChallenge();
    if (!silent) setStatus('warn', 'Your previous challenge is no longer available.');
    return { state: 'cleared_missing' };
  }

  const status = current.status;
  if (status === 'open') {
    const refreshed = {
      code: current.code || cached.code,
      matchId: current.id || cached.matchId,
      createdAt: cached.createdAt,
      expiresAt: cached.expiresAt,
    };
    S.pendingChallenge = refreshed;
    savePendingChallenge(refreshed);
    if (isChallengeExpired(refreshed)) {
      if (!silent) setStatus('warn', 'Challenge expired. Tap Cancel Challenge to release it.');
      return { state: 'expired_open' };
    }
    return { state: 'open' };
  }
  if (status === 'playing' || status === 'done') {
    clearPendingChallenge();
    try { onVatarMatch(current); } catch {}
    return { state: 'started', match: current };
  }
  clearPendingChallenge();
  if (!silent) setStatus('warn', 'That challenge is ' + status + '.');
  return { state: 'cleared_' + status };
}

// ---------- Vatar callbacks ----------
async function onVatarMatch(m) {
  S.current = m;
  if (!m) return;

  if (m.status === 'open') {
    if (S.pendingChallenge && S.pendingChallenge.matchId === m.id) {
      const refreshed = { ...S.pendingChallenge, code: m.code || S.pendingChallenge.code };
      S.pendingChallenge = refreshed; savePendingChallenge(refreshed);
    }
    goto('match');
    setText('mt-title', 'Waiting');
    setText('mt-code', m.code || '');
    setStatus('warn', 'Waiting for opponent to join');
    setText('mt-verdict', 'Share the code: ' + (m.code || '—'));
    show('mt-moves', false);
    return;
  }
  if (m.status === 'playing') {
    setStatus('ok', 'Match started');
    setText('mt-verdict', 'Fetching match…');
    playSound('found');
    try { await registerMatch(m.id); } catch (e) { setStatus('err', "Couldn't start: " + e.message); }
    return;
  }
  if (m.status === 'done') {
    stopPolling(); stopTimer();
    setStatus('ok', 'Match complete');
    const won = m.winner && vatar.player && m.winner === vatar.player.id;
    setText('mt-verdict', m.winner ? (won ? 'You win!' : 'You lose.') : 'Settled.');
    show('mt-moves', false);
    show('mt-after', true);
    return;
  }
  if (m.status === 'cancelled' || m.status === 'void') {
    stopPolling(); stopTimer();
    setStatus('warn', 'Match ' + m.status);
    show('mt-moves', false);
    show('mt-after', true);
    clearPendingChallenge();
  }
}

async function registerMatch(vatarMatchId) {
  await ensureBackendSession();
  const view = await api('/api/match/register', { method: 'POST', body: { vatarMatchId } });
  S.local = view;
  S.lastRound = view.round || 0;
  goto('match');
  setText('mt-title', 'Match');
  setText('mt-code', view.code || '');
  show('mt-moves', true);
  show('mt-after', false);
  setStatus('ok', view.opponent ? 'Both players connected' : 'Waiting…');
  startPolling(vatarMatchId);
}

// ---------- polling ----------
function startPolling(matchId) {
  stopPolling();
  S.pollTimer = setInterval(() => pollOnce(matchId), 1500);
  pollOnce(matchId);
}
function stopPolling() { if (S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; } }

async function pollOnce(matchId) {
  try {
    const view = await api(`/api/match/${encodeURIComponent(matchId)}`);
    renderMatch(view);
  } catch (e) {
    if (e.status === 401) S.token = null;
    if (e.status === 404) { stopPolling(); setStatus('err', 'Match unavailable'); }
  }
}

function renderMatch(v) {
  S.local = v;
  const moves = document.querySelectorAll('#mt-moves .move');
  const complete = v.status === 'resolved';

  setText('mt-p1', emoji(v.yourChoice));
  if (complete) setText('mt-p2', emoji(v.opponentChoice));

  moves.forEach((btn) => {
    btn.disabled = complete || v.youSubmitted;
    btn.classList.toggle('is-picked', btn.dataset.choice === v.yourChoice);
  });

  if (complete) {
    stopTimer();
    setStatus('ok', 'Round complete');
    let text = "It's a draw.";
    if (v.winner === 'you')      { text = 'You win!';  playSound('win'); }
    else if (v.winner === 'opponent') { text = 'You lose.'; playSound('lose'); }
    else playSound('draw');
    setText('mt-verdict', text);
    show('mt-moves', false);
    show('mt-after', true);
    addTape('mt-tape', `${emoji(v.yourChoice)} vs ${emoji(v.opponentChoice)}`, text,
      v.winner === 'you' ? 'res-w' : v.winner === 'opponent' ? 'res-l' : 'res-t');
    return;
  }

  if (v.youSubmitted && v.opponentSubmitted) setText('mt-verdict', 'Revealing…');
  else if (v.youSubmitted) { setText('mt-verdict', "Waiting for opponent…"); setText('mt-p2', '…'); }
  else if (v.opponentSubmitted) { setText('mt-verdict', 'Opponent moved. Your turn.'); setText('mt-p2', '…'); }
  else setText('mt-verdict', 'Make your move.');

  renderTimer(v.deadline);
}

function setStatus(kind, text) {
  const el = $('mt-status');
  if (!el) return;
  el.dataset.kind = kind;
  el.textContent = text;
}

// ---------- turn timer ----------
function renderTimer(deadline) {
  if (!deadline) { show('mt-timer', false); return; }
  show('mt-timer', true);
  stopTimer();
  const total = 20000;
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    const pct = Math.max(0, Math.min(1, left / total));
    const fill = $('mt-timer-fill');
    if (fill) fill.style.width = (pct * 100).toFixed(1) + '%';
    setText('mt-timer-text', Math.ceil(left / 1000) + 's');
    const timer = $('mt-timer');
    if (timer) timer.classList.toggle('is-low', left < 5000);
    if (left <= 0) stopTimer();
  };
  tick();
  S.countdownTimer = setInterval(tick, 200);
}
function stopTimer() {
  if (S.countdownTimer) { clearInterval(S.countdownTimer); S.countdownTimer = null; }
  show('mt-timer', false);
}

// ---------- multiplayer actions ----------
function mpSetStake(value) {
  S.stake = value === 'staked' ? 0 : Number(value) || 0;
  document.querySelectorAll('[data-action="mp-set-stake"]').forEach((b) => {
    const on = String(S.stake) === b.dataset.stake || (S.stake === 0 && b.dataset.stake === '0');
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  refreshMpAvailability();
}

async function mpQuick() {
  ensureAudioUnlocked();
  const gate = canSendQuickMatch({ busy: S.quickBusy, lastAt: S.quickLastAt });
  if (!gate.ok) {
    if (gate.reason === 'busy') return;
    setStatus('warn', 'Please wait a moment before trying again.');
    return;
  }
  S.quickBusy = true;
  S.quickLastAt = Date.now();
  S.quickState = 'finding';
  refreshQuickButtons();

  try {
    await ensureBackendSession();
    setStatus('warn', 'Finding opponent…');
    const m = await matchApi().quick({ stake: S.stake });
    S.quickState = 'found';
    setStatus('ok', 'Match found!');
    if (m) onVatarMatch(m);
  } catch (e) {
    const code = (e && e.code) || (e && e.message) || 'error';
    S.quickState = classifyError(code) === 'rate' ? 'failed' : 'failed';
    setStatus('err', messageForCode(code));
  } finally {
    S.quickBusy = false;
    refreshQuickButtons();
  }
}

function refreshQuickButtons() {
  const q = document.querySelector('[data-action="mp-quick"]');
  if (q) q.disabled = S.quickBusy;
  const c = document.querySelector('[data-action="mp-create"]');
  if (c) c.disabled = S.quickBusy;
  const j = document.querySelector('[data-action="mp-join"]');
  if (j) j.disabled = S.quickBusy;
}

async function mpCreate() {
  ensureAudioUnlocked();
  if (S.quickBusy) return;

  const existing = S.pendingChallenge || loadPendingChallenge();
  if (isChallengeUsable(existing)) {
    S.pendingChallenge = existing;
    renderChallengePending();
    goto('mp');
    setStatus('warn', 'You already have a waiting challenge.');
    return;
  }

  S.quickBusy = true; refreshQuickButtons();
  try {
    await ensureBackendSession();
    setStatus('warn', 'Creating challenge…');
    const m = await matchApi().create({ stake: S.stake, seats: 2 });
    if (m && m.code) {
      const p = newPendingChallenge({ code: m.code, matchId: m.id });
      S.pendingChallenge = p;
      savePendingChallenge(p);
    }
    if (m) onVatarMatch(m);
    renderChallengePending();
  } catch (e) {
    const code = (e && e.code) || (e && e.message) || 'error';
    setStatus('err', messageForCode(code));
  } finally {
    S.quickBusy = false; refreshQuickButtons();
  }
}

async function mpCancelChallenge() {
  const p = S.pendingChallenge || loadPendingChallenge();
  if (!p) { clearPendingChallenge(); renderChallengePending(); return; }

  setStatus('warn', 'Cancelling challenge…');
  if (vatar.ready) {
    try { await matchApi().leave(); }
    catch (e) {
      const code = (e && e.code) || (e && e.message) || 'error';
      if (classifyError(code) === 'terminal' || code === 'not_found' || code === 'not_open') {
        clearPendingChallenge(); renderChallengePending();
        setStatus('ok', 'Challenge released.');
        return;
      }
      setStatus('err', messageForCode(code));
      return;
    }
  }
  clearPendingChallenge();
  renderChallengePending();
  setStatus('ok', 'Challenge cancelled.');
}

async function mpJoin() {
  ensureAudioUnlocked();
  const code = ($('mp-code').value || '').trim().toUpperCase();
  if (!code) return;
  const gate = canSendQuickMatch({ busy: S.quickBusy, lastAt: S.quickLastAt });
  if (!gate.ok) {
    if (gate.reason === 'busy') return;
    setStatus('warn', 'Please wait a moment before trying again.');
    return;
  }
  S.quickBusy = true; S.quickLastAt = Date.now(); refreshQuickButtons();
  try {
    await ensureBackendSession();
    setStatus('warn', 'Joining…');
    const m = await matchApi().join(code);
    if (m) onVatarMatch(m);
  } catch (e) {
    const ec = (e && e.code) || (e && e.message) || 'error';
    setStatus('err', messageForCode(ec));
  } finally {
    S.quickBusy = false; refreshQuickButtons();
  }
}

async function mpPlay(choice) {
  if (!S.local) return;
  ensureAudioUnlocked();
  playSound('choice', choice);
  document.querySelectorAll('#mt-moves .move').forEach((b) => (b.disabled = true));
  try {
    const r = await api(`/api/match/${encodeURIComponent(S.local.matchId)}/choice`, {
      method: 'POST', body: { choice },
    });
    playSound('confirm');
    if (r.resolved && r.vatar && !r.vatar.ok) {
      setStatus('warn', 'Round decided, settlement pending');
    }
  } catch (e) {
    setStatus('err', 'Error: ' + e.message);
    document.querySelectorAll('#mt-moves .move').forEach((b) => (b.disabled = false));
  }
}

async function mpLeave() {
  stopPolling(); stopTimer();
  try { await matchApi().leave(); } catch { /* best effort */ }
  clearPendingChallenge();
  S.current = null; S.local = null;
  goto('mp');
}

async function mpAgain() {
  stopPolling(); stopTimer();
  try { await matchApi().leave(); } catch { /* ignore */ }
  clearPendingChallenge();
  S.current = null; S.local = null;
  goto('mp');
}

// ---------- purchases / cosmetics ----------
function setBrandLogo(src) {
  // Swap the in-game logo. Safe to call when the element is missing.
  const logo = document.querySelector('.brand-mark img');
  if (!logo) return;
  if (logo.getAttribute('src') !== src) logo.setAttribute('src', src);
}

function applyEntitlements(ents) {
  S.entitlements = ents || {};
  const owned = !!S.entitlements[NEON_ARENA_PRODUCT_ID];
  document.body.classList.toggle(NEON_THEME_CLASS, owned);
  // Neon Arena swaps the in-game logo to the neon variant. Falls back to the
  // default mark if /assets/logo2.png is missing — the browser just 404s and
  // shows the alt text, no gameplay effect.
  setBrandLogo(owned ? LOGO_NEON : LOGO_DEFAULT);
  renderNeonStatus();
}

function renderNeonStatus() {
  const btn = document.querySelector('[data-action="buy-neon"]');
  const sub = $('neon-status');
  const owned = !!S.entitlements[NEON_ARENA_PRODUCT_ID];
  if (sub) sub.textContent = owned
    ? 'Owned — Neon Arena theme is active.'
    : 'Unlock a cyan-and-magenta look.';
  if (btn) btn.disabled = owned || !purchasesSupported();
}

async function refreshEntitlements() {
  if (!S.playerId) return;
  try {
    const r = await api('/api/purchase/entitlements');
    applyEntitlements(r.entitlements || {});
  } catch { /* ignore — theme simply remains default */ }
}

async function claimPurchase(purchaseId) {
  if (!purchaseId) return { ok: false };
  try {
    const r = await api('/api/purchase/claim', { method: 'POST', body: { purchaseId } });
    if (r && r.ok) {
      await refreshEntitlements();
      setStatus('ok', 'Neon Arena unlocked.');
    }
    return r;
  } catch (e) {
    setStatus('err', 'Could not claim purchase: ' + (e.data?.error || e.message));
    return { ok: false };
  }
}

async function buyNeon() {
  ensureAudioUnlocked();
  if (!purchasesSupported()) { setStatus('err', messageForCode('not_available')); return; }
  if (S.entitlements[NEON_ARENA_PRODUCT_ID]) return;
  try {
    const p = await requestPurchase(NEON_ARENA_PRODUCT_ID);
    if (p && p.purchaseId) await claimPurchase(p.purchaseId);
  } catch (e) {
    const code = (e && e.code) || (e && e.message) || 'error';
    setStatus('err', messageForCode(code));
  }
}

async function restoreUndeliveredPurchases() {
  const list = await listUndeliveredPurchases();
  for (const p of list) {
    try { await claimPurchase(p.purchaseId); } catch { /* ignore */ }
  }
}

// ---------- delegated clicks ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'goto':      return goto(el.dataset.screen);
    case 'sp-play':   return playSP(el.dataset.choice);
    case 'mp-set-stake': return mpSetStake(el.dataset.stake);
    case 'mp-quick':  return mpQuick();
    case 'mp-create': return mpCreate();
    case 'mp-show-join': show('mp-join-row', true); return;
    case 'mp-join':   return mpJoin();
    case 'mp-play':   return mpPlay(el.dataset.choice);
    case 'mp-leave':  return mpLeave();
    case 'mp-again':  return mpAgain();
    case 'mp-cancel-challenge': return mpCancelChallenge();
    case 'buy-neon':  return buyNeon();
    case 'toggle-sfx':
      ensureAudioUnlocked();
      S.audioPrefs.sfx = !S.audioPrefs.sfx;
      Audio.setSfxOn(S.audioPrefs.sfx);
      saveAudioPrefs(); refreshAudioToggles();
      return;
    case 'toggle-music':
      ensureAudioUnlocked();
      S.audioPrefs.music = !S.audioPrefs.music;
      Audio.setMusicOn(S.audioPrefs.music);
      saveAudioPrefs(); refreshAudioToggles();
      return;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'mp-code') mpJoin();
});

// First user gesture anywhere unlocks audio.
document.addEventListener('pointerdown', () => { ensureAudioUnlocked(); }, { once: true });
document.addEventListener('keydown', () => { ensureAudioUnlocked(); }, { once: true });

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', async () => {
  loadAudioPrefs();
  refreshAudioToggles();
  S.pendingChallenge = loadPendingChallenge();

  // Default logo. applyEntitlements will override once the backend answers.
  setBrandLogo(LOGO_DEFAULT);

  goto('menu');
  await initVatar({
    onMatch: onVatarMatch,
    onPause: () => { stopTimer(); Audio.pauseMusic(); },
    onResume: async () => {
      Audio.resumeMusic();
      if (S.current && S.current.id) startPolling(S.current.id);
      try { await reconcilePendingChallenge({ silent: true }); } catch {}
      try { await restoreUndeliveredPurchases(); } catch {}
    },
  });

  if (vatar.ready && vatar.player) {
    setText('whoami', vatar.player.name || 'Player');
    try {
      await ensureBackendSession();
      await refreshEntitlements();
      await restoreUndeliveredPurchases();
      onVatarPurchase(async (p) => {
        if (p && p.purchaseId) await claimPurchase(p.purchaseId);
      });

      await reconcilePendingChallenge({ silent: true });

      if (!S.current) {
        try {
          const m = await matchApi().current();
          if (m && m.id) { S.current = m; onVatarMatch(m); }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  } else {
    renderNeonStatus();
  }

  refreshMpAvailability();
  refreshQuickButtons();
});