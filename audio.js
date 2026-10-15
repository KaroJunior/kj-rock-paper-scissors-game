// Minimal, original Web Audio synthesizer for RPS.
// - SFX: very short oscillator bursts, cleaned up on 'ended'.
// - Music: two soft sine oscillators, gain-modulated; no continuous CPU work.
// - Everything degrades silently if Web Audio is unavailable or muted.
// - Audio never starts until the first user gesture (call unlock()).
import { defaultAudioPrefs } from './logic.mjs';

let ctx = null;
let sfxOn = true;
let musicOn = false;
let musicNodes = null;
let unlocked = false;

function getCtx() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch { ctx = null; }
  return ctx;
}

function beep({ freq, dur = 0.08, type = 'sine', gain = 0.07 }) {
  if (!sfxOn || !unlocked) return;
  const c = getCtx();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = c.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
    osc.onended = () => { try { g.disconnect(); } catch {} };
  } catch { /* never let audio break gameplay */ }
}

let seqTimer = null;
function sequence(notes, stepMs = 80, base = { dur: 0.1, type: 'sine', gain: 0.07 }) {
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
  // Kick the context on iOS: resume on user gesture.
  if (c && c.state === 'suspended') { try { c.resume(); } catch {} }
  if (musicOn) startMusic();
}

export function playChoice(choice) {
  const freqs = { rock: 196, paper: 294, scissors: 392 };
  beep({ freq: freqs[choice] || 262, dur: 0.07, type: 'triangle', gain: 0.06 });
}
export function playConfirm() { beep({ freq: 523, dur: 0.06, gain: 0.05 }); }
export function playDraw()    { beep({ freq: 440, dur: 0.14, gain: 0.06 }); }
export function playWin()     { sequence([523, 659, 784], 80, { dur: 0.12, gain: 0.07 }); }
export function playLose()    { sequence([392, 330, 262], 95, { dur: 0.14, gain: 0.07 }); }
export function playMatchFound() { sequence([523, 659, 784, 1047], 60, { dur: 0.09, gain: 0.06 }); }

export function startMusic() {
  if (!musicOn || !unlocked) return;
  const c = getCtx();
  if (!c || musicNodes) return;
  try {
    const osc1 = c.createOscillator();
    const osc2 = c.createOscillator();
    const g = c.createGain();
    osc1.type = 'sine'; osc1.frequency.value = 110;
    osc2.type = 'sine'; osc2.frequency.value = 165;
    g.gain.value = 0.018;
    osc1.connect(g); osc2.connect(g); g.connect(c.destination);
    osc1.start(); osc2.start();
    musicNodes = { osc1, osc2, g };
  } catch { musicNodes = null; }
}
export function stopMusic() {
  if (!musicNodes) return;
  try { musicNodes.osc1.stop(); } catch {}
  try { musicNodes.osc2.stop(); } catch {}
  try { musicNodes.g.disconnect(); } catch {}
  musicNodes = null;
}
export function pauseMusic() {
  if (!musicNodes) return;
  try { musicNodes.g.gain.value = 0; } catch {}
}
export function resumeMusic() {
  if (!musicNodes || !musicOn) return;
  try { musicNodes.g.gain.value = 0.018; } catch {}
}

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