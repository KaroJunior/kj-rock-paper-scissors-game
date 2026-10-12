// Frontend only. No Firebase SDK, no secrets.
// Talks to /api/* (Netlify Functions) for multiplayer.
// Single-player runs entirely in the browser.

// ---------- state ----------
const state = {
  mode: 'single-player',
  playerScore: 0,
  computerScore: 0,
  // multiplayer:
  code: null,
  token: null,
  playerId: null,
  pollTimer: null,
  lastRoundNumber: 1,
};

// ---------- screen switching ----------
const modeButtons = document.querySelectorAll('.mode-btn');
const gameScreens = document.querySelectorAll('.game-screen');

function showScreen(screenId) {
  modeButtons.forEach(btn => btn.classList.remove('active'));
  const btn = Array.from(modeButtons).find(b => b.getAttribute('onclick')?.includes(screenId));
  if (btn) btn.classList.add('active');
  gameScreens.forEach(s => s.classList.remove('active-screen'));
  document.getElementById(screenId).classList.add('active-screen');
  state.mode = screenId;
}

function showJoinSection(show) {
  document.getElementById('join-section').style.display = show ? 'flex' : 'none';
}

// ---------- single player (unchanged) ----------
function getEmoji(choice) {
  switch (choice) {
    case 'rock': return '✊';
    case 'paper': return '✋';
    case 'scissors': return '✌️';
    default: return '?';
  }
}

function addToHistory(text, isMultiplayer = false) {
  const historyElement = isMultiplayer
    ? document.getElementById('mp-history')
    : document.getElementById('sp-history');
  if (!historyElement) return;
  const item = document.createElement('div');
  item.className = 'history-item';
  const parts = text.split(' - ');
  if (parts[1] === 'You win!') {
    item.innerHTML = `${parts[0]} - <span class="winner">${parts[1]}</span>`;
  } else if (parts[1] === 'You lose!') {
    item.innerHTML = `${parts[0]} - <span class="loser">${parts[1]}</span>`;
  } else {
    item.innerHTML = text;
  }
  historyElement.prepend(item);
  while (historyElement.children.length > 5) {
    historyElement.removeChild(historyElement.lastChild);
  }
}

function playGame(playerChoice) {
  const choices = ['rock', 'paper', 'scissors'];
  const computerChoice = choices[Math.floor(Math.random() * 3)];
  const playerChoiceElement = document.getElementById('player-choice');
  playerChoiceElement.classList.add('shake');

  setTimeout(() => {
    playerChoiceElement.textContent = getEmoji(playerChoice);
    playerChoiceElement.classList.remove('shake');
    const computerChoiceElement = document.getElementById('computer-choice');
    computerChoiceElement.textContent = getEmoji(computerChoice);
    computerChoiceElement.classList.add('reveal');
    setTimeout(() => computerChoiceElement.classList.remove('reveal'), 500);

    let result;
    if (playerChoice === computerChoice) {
      result = "It's a tie!";
    } else if (
      (playerChoice === 'rock' && computerChoice === 'scissors') ||
      (playerChoice === 'paper' && computerChoice === 'rock') ||
      (playerChoice === 'scissors' && computerChoice === 'paper')
    ) {
      result = 'You win!';
      state.playerScore++;
    } else {
      result = 'Computer wins!';
      state.computerScore++;
    }

    document.getElementById('player-score').textContent = state.playerScore;
    document.getElementById('computer-score').textContent = state.computerScore;
    document.getElementById('sp-result').textContent = result;
    addToHistory(`You: ${getEmoji(playerChoice)} vs Computer: ${getEmoji(computerChoice)} - ${result}`);
  }, 500);
}

// ---------- multiplayer: API helpers ----------
async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (state.token && options.auth !== false) {
    headers.authorization = `Bearer ${state.token}`;
  }
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}

function persistSession() {
  if (state.code && state.token && state.playerId) {
    localStorage.setItem('rps_session', JSON.stringify({
      code: state.code, token: state.token, playerId: state.playerId,
    }));
  } else {
    localStorage.removeItem('rps_session');
  }
}

function restoreSession() {
  try {
    const raw = localStorage.getItem('rps_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.code && s.token && s.playerId) return s;
  } catch { /* ignore */ }
  return null;
}

// ---------- multiplayer: flow ----------
async function createGame() {
  document.getElementById('setup-options').style.display = 'none';
  document.getElementById('join-section').style.display = 'none';
  document.getElementById('multiplayer-game').style.display = 'block';
  document.getElementById('mp-choices').style.display = 'none';
  document.getElementById('share-section').style.display = 'block';
  document.getElementById('game-code-display').style.display = 'block';
  document.getElementById('mp-history').innerHTML = '';
  document.getElementById('mp-status').className = 'status-message waiting';
  document.getElementById('mp-status').innerHTML = '<i class="fas fa-clock"></i> Creating match…';

  try {
    const data = await api('/api/match/create', { method: 'POST', body: '{}', auth: false });
    state.code = data.code;
    state.token = data.token;
    state.playerId = data.playerId;
    persistSession();

    const url = `${window.location.origin}${window.location.pathname}?game=${state.code}`;
    document.getElementById('code-display').textContent = state.code;
    document.getElementById('game-link').value = url;
    document.getElementById('mp-status').innerHTML = '<i class="fas fa-clock"></i> Waiting for friend to connect…';
    document.getElementById('mp-status').className = 'status-message waiting';
    document.getElementById('mp-result').textContent = 'Share the code with a friend to start playing';
    document.getElementById('player1-score').textContent = '0';
    document.getElementById('player2-score').textContent = '0';
    document.getElementById('mp-player-choice').textContent = '?';
    document.getElementById('mp-opponent-choice').textContent = '?';

    startPolling();
  } catch (err) {
    document.getElementById('mp-status').innerHTML = '<i class="fas fa-exclamation-triangle"></i> Could not create match';
    document.getElementById('mp-result').textContent = String(err.message || err);
  }
}

async function joinGame() {
  const code = (document.getElementById('game-code').value || '').trim().toUpperCase();
  if (!code) { alert('Please enter a game code'); return; }

  document.getElementById('setup-options').style.display = 'none';
  document.getElementById('multiplayer-game').style.display = 'block';
  document.getElementById('share-section').style.display = 'none';
  document.getElementById('game-code-display').style.display = 'none';
  document.getElementById('mp-choices').style.display = 'none';
  document.getElementById('mp-history').innerHTML = '';
  document.getElementById('mp-status').className = 'status-message waiting';
  document.getElementById('mp-status').innerHTML = '<i class="fas fa-clock"></i> Connecting…';

  try {
    const data = await api('/api/match/join', {
      method: 'POST',
      body: JSON.stringify({ code }),
      auth: false,
    });
    state.code = data.code;
    state.token = data.token;
    state.playerId = data.playerId;
    persistSession();

    document.getElementById('mp-player-choice').textContent = '?';
    document.getElementById('mp-opponent-choice').textContent = '?';
    startPolling();
  } catch (err) {
    document.getElementById('mp-status').innerHTML = '<i class="fas fa-exclamation-triangle"></i> Join failed';
    const result = document.getElementById('mp-result');
    result.textContent = humanJoinError(err);
  }
}

function humanJoinError(err) {
  switch (err.message) {
    case 'match not found': return 'No match with that code. Check with your friend.';
    case 'match is full': return 'That match already has two players.';
    case 'match has ended': return 'That match has already ended.';
    default: return String(err.message || 'Could not join');
  }
}

async function playMultiplayer(choice) {
  if (!state.code) return;
  const buttons = document.querySelectorAll('#mp-choices .choice');
  buttons.forEach(b => b.classList.add('disabled'));
  document.getElementById('mp-result').textContent = 'Submitting…';
  try {
    await api(`/api/match/${state.code}/choice`, {
      method: 'POST',
      body: JSON.stringify({ choice }),
    });
    // Poll will pick up the rest.
  } catch (err) {
    document.getElementById('mp-result').textContent = `Error: ${err.message}`;
    buttons.forEach(b => b.classList.remove('disabled'));
  }
}

async function leaveMultiplayerGame() {
  stopPolling();
  try {
    if (state.code && state.token) {
      await api(`/api/match/${state.code}/leave`, { method: 'POST', body: '{}' });
    }
  } catch { /* best effort */ }
  state.code = null;
  state.token = null;
  state.playerId = null;
  persistSession();
  window.location.href = window.location.pathname;
}

// ---------- multiplayer: polling ----------
function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(pollOnce, 1500);
  pollOnce();
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function pollOnce() {
  if (!state.code || !state.token) return;
  try {
    const data = await api(`/api/match/${state.code}`, { method: 'GET' });
    renderMatch(data);
  } catch (err) {
    if (err.status === 401 || err.status === 404) {
      stopPolling();
      document.getElementById('mp-status').innerHTML = '<i class="fas fa-exclamation-circle"></i> Match unavailable';
      document.getElementById('mp-result').textContent = 'The match could not be found.';
    }
  }
}

function renderMatch(m) {
  const statusEl = document.getElementById('mp-status');
  const resultEl = document.getElementById('mp-result');
  const choicesEl = document.getElementById('mp-choices');

  // Opponent presence
  if (m.status === 'waiting') {
    statusEl.className = 'status-message waiting';
    statusEl.innerHTML = '<i class="fas fa-clock"></i> Waiting for friend to connect…';
    resultEl.textContent = 'Share the code with a friend to start playing';
    choicesEl.style.display = 'none';
    document.getElementById('share-section').style.display = 'block';
    return;
  }

  if (m.status === 'ended') {
    stopPolling();
    statusEl.className = 'status-message waiting';
    statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Match ended';
    resultEl.textContent = 'The other player left the game.';
    choicesEl.style.display = 'none';
    return;
  }

  // Active
  statusEl.className = 'status-message connected';
  statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Connected';
  document.getElementById('share-section').style.display = 'none';
  document.getElementById('game-code-display').style.display = 'block';
  choicesEl.style.display = 'flex';

  // Scores
  document.getElementById('player1-score').textContent = String(m.you.score ?? 0);
  document.getElementById('player2-score').textContent = String(m.opponent?.score ?? 0);

  const round = m.round;
  if (!round) return;

  // Reset reveal animation on new round
  if (round.number !== state.lastRoundNumber) {
    state.lastRoundNumber = round.number;
    document.getElementById('mp-player-choice').textContent = '?';
    document.getElementById('mp-opponent-choice').textContent = '?';
  }

  const buttons = document.querySelectorAll('#mp-choices .choice');
  const disable = round.status === 'complete' || round.youSubmitted;

  buttons.forEach(b => b.classList.toggle('disabled', disable));

  // Player's own choice
  if (round.yourChoice) {
    document.getElementById('mp-player-choice').textContent = getEmoji(round.yourChoice);
  }

  if (round.status === 'complete') {
    // Reveal opponent choice with a short delay
    document.getElementById('mp-opponent-choice').textContent = getEmoji(round.opponentChoice);
    const revealEl = document.getElementById('mp-opponent-choice');
    revealEl.classList.add('reveal');
    setTimeout(() => revealEl.classList.remove('reveal'), 500);

    if (round.result === 'win') resultEl.textContent = 'You win!';
    else if (round.result === 'lose') resultEl.textContent = 'You lose!';
    else resultEl.textContent = "It's a tie!";

    // History line
    // (A more complete history is in m.history; we re-render from that below.)
  } else if (round.youSubmitted && round.opponentSubmitted) {
    resultEl.textContent = 'Revealing…';
  } else if (round.youSubmitted) {
    resultEl.textContent = "Waiting for friend's move…";
    document.getElementById('mp-opponent-choice').textContent = '...';
  } else if (round.opponentSubmitted) {
    resultEl.textContent = 'Your friend has made a choice! Your turn.';
    document.getElementById('mp-opponent-choice').textContent = '...';
  } else {
    resultEl.textContent = 'Make your move!';
    document.getElementById('mp-opponent-choice').textContent = '?';
  }

  renderHistory(m.history);
}

let lastHistoryLength = -1;
function renderHistory(history) {
  if (!Array.isArray(history)) return;
  if (history.length === lastHistoryLength) return;
  lastHistoryLength = history.length;

  const historyEl = document.getElementById('mp-history');
  historyEl.innerHTML = '';
  // Newest first, max 5
  for (const entry of history.slice().reverse().slice(0, 5)) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const you = getEmoji(entry.yourChoice);
    const opp = getEmoji(entry.opponentChoice);
    let resultText;
    if (entry.result === 'win') resultText = '<span class="winner">You win!</span>';
    else if (entry.result === 'lose') resultText = '<span class="loser">You lose!</span>';
    else resultText = "It's a tie!";
    item.innerHTML = `You: ${you} vs Friend: ${opp} - ${resultText}`;
    historyEl.appendChild(item);
  }
}

// ---------- sharing ----------
function copyLink() {
  const input = document.getElementById('game-link');
  input.select();
  document.execCommand('copy');
  alert('Game link copied to clipboard!');
}

function shareViaWhatsApp() {
  const url = document.getElementById('game-link').value;
  const text = `Join me for a game of Rock Paper Scissors! ${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

// ---------- init ----------
async function init() {
  // If we have a stored session, restore it and reconnect to the match.
  const stored = restoreSession();
  const urlParams = new URLSearchParams(window.location.search);
  const urlCode = (urlParams.get('game') || '').toUpperCase();

  if (stored && stored.code && (!urlCode || urlCode === stored.code)) {
    state.code = stored.code;
    state.token = stored.token;
    state.playerId = stored.playerId;
    document.getElementById('multiplayer-game').style.display = 'block';
    document.getElementById('setup-options').style.display = 'none';
    showScreen('multiplayer');
    startPolling();
    return;
  }

  if (urlCode) {
    document.getElementById('game-code').value = urlCode;
    showScreen('multiplayer');
    setTimeout(joinGame, 400);
  }
}

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('beforeunload', () => {
  // Best-effort notify server we're leaving; not required for correctness.
  if (state.code && state.token) {
    navigator.sendBeacon?.(
      `/api/match/${state.code}/leave`,
      new Blob([JSON.stringify({})], { type: 'application/json' })
    );
  }
});

// ---------- delegated click handling (replaces inline onclick) ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  const action = el.dataset.action;
  const choice = el.dataset.choice;
  const screen = el.dataset.screen;

  switch (action) {
    case 'show-screen':     return showScreen(screen);
    case 'play-sp':         return playGame(choice);
    case 'create-game':     return createGame();
    case 'show-join':       return showJoinSection(true);
    case 'join-game':       return joinGame();
    case 'play-mp':         return playMultiplayer(choice);
    case 'copy-link':       return copyLink();
    case 'share-whatsapp':  return shareViaWhatsApp();
    case 'leave-mp':        return leaveMultiplayerGame();
  }
});