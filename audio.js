// Minimal, original Web Audio synthesizer for RPS.
// - SFX: very short oscillator bursts, cleaned up on 'ended'. Routed through
//   a shared sfx gain bus so the overall level is easy to tune.
// - Music: a short 4-note arpeggio loop with a bass note per bar. Schedules
//   notes with setTimeout rather than continuous oscillators, so CPU stays
//   low and pause/resume is trivial.
// - Audio never starts until the first user gesture (call unlock()).
import { defaultAudioPrefs } from './logic.mjs';

// ---- Tunables --------------------------------------------------------------
// Overall loudness knobs. Bump these if you want it louder.
const SFX_LEVEL   = 1.9;   // applied on top of per-effect source gains
const MUSIC_LEVEL = 1.4;   // applied on top of per-note gains
// If you want it louder still: bump SFX_LEVEL (SFX) and MUSIC_LEVEL (music). Values above ~3 can clip on some phones — Web Audio has no limiter by default

// Per-effect source gains (before SFX_LEVEL).
const G = {
  choice: 0.10,
  confirm: 0.10,
  draw: 0.12,
  win: 0.13,
  lose: 0.13,
  found: 0.12,
  musicNote: 0.08,
  musicBass: 0.07,
};

// Music pattern: pitches in Hz. Simple C-major arpeggio, loops every 4 steps.
const MUSIC_PATTERN = [261.63, 329.63, 392.00, 329.63];
const MUSIC_BASS    = 130.81;   // C3, one per bar
const MUSIC_STEP_MS = 280;      // ~214 BPM eighth-notes feel
// ---------------------------------------------------------------------------

let ctx = null;
let sfxOn = true;
let musicOn = false;
let unlocked = false;
let sfxGain = null;
let musicGain = null;
let musicTimer = null;
let musicBeat = 0;
let seqTimer = null;

function getCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_LEVEL;
    sfxGain.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_LEVEL;
    musicGain.connect(ctx.destination);
  } catch { ctx = null; }
  return ctx;
}

function beep({ freq, dur = 0.08, type = 'sine', gain = 0.1, bus = 'sfx' }) {
  if (!sfxOn || !unlocked) return;
  const c = getCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = c.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(bus === 'music' ? musicGain : sfxGain);
    osc.start(now);
    osc.stop(now + dur + 0.03);
    osc.onended = () => { try { g.disconnect(); } catch {} };
  } catch { /* never let audio break gameplay */ }
}

function sequence(notes, stepMs = 80, base = { dur: 0.1, type: 'sine', gain: 0.1 }) {
  if (!sfxOn || !unlocked) return;
  stopSequence();
  notes.forEach((f, i) => {
    seqTimer = setTimeout(() => { beep({ freq: f, ...base }); }, i * stepMs);
  });
}
function stopSequence() {
  if (seqTimer) { clearTimeout(seqTimer); seqTimer = null; }
}

export function unlock() {
  if (unlocked) return;
  unlocked = true;
  const c = getCtx();
  if (c && c.state === 'suspended') { try { c.resume(); } catch {} }
  if (musicOn) startMusic();
}

// ---------- SFX ----------
export function playChoice(choice) {
  const freqs = { rock: 196, paper: 294, scissors: 392 };
  beep({ freq: freqs[choice] || 262, dur: 0.07, type: 'triangle', gain: G.choice });
}
export function playConfirm() { beep({ freq: 523, dur: 0.06, gain: G.confirm }); }
export function playDraw()    { beep({ freq: 440, dur: 0.14, gain: G.draw }); }
export function playWin()     { sequence([523, 659, 784], 80, { dur: 0.12, gain: G.win }); }
export function playLose()    { sequence([392, 330, 262], 95, { dur: 0.14, gain: G.lose }); }
export function playMatchFound() { sequence([523, 659, 784, 1047], 60, { dur: 0.09, gain: G.found }); }

// ---------- Music ----------
function playMusicNote(freq, dur, gain) {
  if (!musicOn || !unlocked) return;
  const c = getCtx();
  if (!c || !musicGain) return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const now = c.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(musicGain);
    osc.start(now);
    osc.stop(now + dur + 0.05);
    osc.onended = () => { try { g.disconnect(); } catch {} };
  } catch { /* silent */ }
}

function musicTick() {
  if (!musicOn || !unlocked) { musicTimer = null; return; }
  const freq = MUSIC_PATTERN[musicBeat % MUSIC_PATTERN.length];
  playMusicNote(freq, 0.34, G.musicNote);
  if (musicBeat % MUSIC_PATTERN.length === 0) {
    playMusicNote(MUSIC_BASS, 0.6, G.musicBass);
  }
  musicBeat++;
  musicTimer = setTimeout(musicTick, MUSIC_STEP_MS);
}

export function startMusic() {
  if (!musicOn || !unlocked || musicTimer) return;
  musicBeat = 0;
  musicTick();
}
export function stopMusic() {
  if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
}
export function pauseMusic() { stopMusic(); }
export function resumeMusic() { if (musicOn) startMusic(); }

// ---------- toggles ----------
export function setSfxOn(v) {
  sfxOn = !!v;
  if (!sfxOn) stopSequence();
}
export function isSfxOn() { return sfxOn; }

export function setMusicOn(v) {
  musicOn = !!v;
  if (musicOn) startMusic(); else stopMusic();
}
export function isMusicOn() { return musicOn; }

export function applyPrefs(prefs) {
  const p = prefs || defaultAudioPrefs();
  setSfxOn(p.sfx);
  setMusicOn(p.music);
}