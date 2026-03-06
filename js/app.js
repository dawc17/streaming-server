/**
 * Streaming frontend – app.js
 * Protocol : HTTP-FLV via flv.js
 * Server   : SRS (Simple Realtime Server)
 *
 * ── HOW IT WORKS ─────────────────────────────────────────────────────────────
 * 1. SRS receives RTMP from OBS and remuxes to HTTP-FLV on port 8080.
 * 2. nginx proxies /live/*.flv → SRS with proxy_buffering off.
 * 3. flv.js opens an HTTP chunked request and feeds the FLV tags into MSE.
 * 4. ~1-2 s latency, works over any HTTP tunnel (ngrok, Cloudflare, etc.).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  flvUrl:        `${window.location.protocol}//${window.location.host}/live/test.flv`,
  streamTitle:   'Live Stream',
  retryInterval: 3000,
};

// ── DOM refs ──────────────────────────────────────────────
const video            = document.getElementById('video-player');
const playerWrapper    = document.getElementById('player-wrapper');
const playerFrame      = document.querySelector('.player-frame');
const overlay          = document.getElementById('overlay');
const loadingSpinner   = document.getElementById('loading-spinner');
const offlineMsg       = document.getElementById('offline-message');
const liveBadge        = document.getElementById('live-badge');
const connectingBadge  = document.getElementById('connecting-badge');
const retryBtn         = document.getElementById('retry-btn');
const streamTitleEl    = document.getElementById('stream-title');
const streamUrlDisplay = document.getElementById('stream-url-display');
const viewerQuality    = document.getElementById('viewer-quality');
const clockEl          = document.getElementById('clock');
const hudOverlay       = document.getElementById('hud-overlay');
const footerStatus     = document.getElementById('footer-status');
const signalBars       = document.querySelector('.signal-bars');

// Telemetry
const teleUptime  = document.getElementById('tele-uptime');
const teleFrames  = document.getElementById('tele-frames');
const teleCodec   = document.getElementById('tele-codec');
const signalInd   = document.getElementById('signal-indicator');
const signalText  = document.getElementById('signal-text');

// HUD
const hudTimecode = document.getElementById('hud-timecode');
const hudRes      = document.getElementById('hud-res');
const hudBitrate  = document.getElementById('hud-bitrate');
const hudRec      = document.getElementById('hud-rec');

// ── Init UI ───────────────────────────────────────────────
streamTitleEl.textContent    = CONFIG.streamTitle;
streamUrlDisplay.textContent = CONFIG.flvUrl;
document.title               = CONFIG.streamTitle;

// ── Clock ─────────────────────────────────────────────────
function tickClock() {
  const now = new Date();
  clockEl.textContent = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':');
}
tickClock();
setInterval(tickClock, 1000);

// ── State ─────────────────────────────────────────────────
let flvPlayer        = null;
let retryTimer       = null;
let liveStartTime    = null;
let statsInterval    = null;
let timecodeInterval = null;
let frameCount       = 0;

// ── UI helpers ────────────────────────────────────────────
function showLoading() {
  overlay.classList.remove('hidden');
  loadingSpinner.classList.remove('hidden');
  offlineMsg.classList.add('hidden');
  liveBadge.classList.add('hidden');
  connectingBadge.classList.remove('hidden');
  playerWrapper.classList.remove('is-live');
  playerFrame.classList.remove('is-live');
  hudOverlay.classList.remove('is-live');
  signalBars.classList.remove('is-live');
  footerStatus.classList.remove('is-live');
  footerStatus.querySelector('.footer-status-dot').style.background = '';
  document.getElementById('footer-status').innerHTML =
    '<span class="footer-status-dot" style="background:var(--cyan);box-shadow:0 0 8px rgba(0,179,65,0.5)"></span> CONNECTING';
}

function showOffline() {
  overlay.classList.remove('hidden');
  loadingSpinner.classList.add('hidden');
  offlineMsg.classList.remove('hidden');
  liveBadge.classList.add('hidden');
  connectingBadge.classList.add('hidden');
  playerWrapper.classList.remove('is-live');
  playerFrame.classList.remove('is-live');
  hudOverlay.classList.remove('is-live');
  signalBars.classList.remove('is-live');
  footerStatus.classList.remove('is-live');
  document.getElementById('footer-status').innerHTML =
    '<span class="footer-status-dot"></span> SYSTEM READY';

  teleUptime.textContent = '00:00:00';
  teleFrames.textContent = '0';
  teleCodec.textContent  = '—';
  signalText.textContent = '—';
  signalInd.className    = 'signal-indicator';

  liveStartTime = null;
  clearInterval(statsInterval);
  clearInterval(timecodeInterval);
}

function showLive() {
  overlay.classList.add('hidden');
  liveBadge.classList.remove('hidden');
  connectingBadge.classList.add('hidden');
  playerWrapper.classList.add('is-live');
  playerFrame.classList.add('is-live');
  hudOverlay.classList.add('is-live');
  signalBars.classList.add('is-live');
  footerStatus.classList.add('is-live');
  document.getElementById('footer-status').innerHTML =
    '<span class="footer-status-dot" style="background:#00ff41;box-shadow:0 0 10px rgba(0,255,65,0.6)"></span> STREAM ACTIVE';

  liveStartTime = Date.now();
  startTelemetry();
  startTimecode();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(initPlayer, CONFIG.retryInterval);
}

function destroyPlayer() {
  clearTimeout(retryTimer);
  clearInterval(statsInterval);
  clearInterval(timecodeInterval);
  clearInterval(uptimeInterval);
  if (flvPlayer) {
    flvPlayer.pause();
    flvPlayer.unload();
    flvPlayer.detachMediaElement();
    flvPlayer.destroy();
    flvPlayer = null;
  }
  video.src = '';
}

// ── Telemetry (bitrate, codec, buffer health, frames) ───
function startTelemetry() {
  clearInterval(statsInterval);
  let lastDecodedFrames = 0;

  statsInterval = setInterval(() => {
    if (!flvPlayer) return;

    // Bitrate from flv.js statistics
    const speed = flvPlayer.statisticsInfo?.speed ?? 0; // KB/s
    if (speed > 0) {
      hudBitrate.textContent = `${Math.round(speed * 8)} kbps`;
    }

    // Codec from mediaInfo (available after first segment)
    const codec = flvPlayer.mediaInfo?.videoCodec;
    if (codec) teleCodec.textContent = codec.split('.')[0].toUpperCase();

    // Resolution
    const w = flvPlayer.mediaInfo?.width;
    const h = flvPlayer.mediaInfo?.height;
    if (w && h) hudRes.textContent = `${w}×${h}`;

    // Frame count via decoded frames
    const decoded = video.webkitDecodedFrameCount ?? 0;
    frameCount += (decoded - lastDecodedFrames);
    lastDecodedFrames = decoded;
    if (decoded > 0) teleFrames.textContent = decoded.toLocaleString();

    // Buffer health → signal quality
    if (video.buffered.length > 0) {
      const bufAhead = video.buffered.end(video.buffered.length - 1) - video.currentTime;
      if (bufAhead > 2) {
        signalInd.className = 'signal-indicator strong';
        signalText.textContent = 'EXCELLENT';
      } else if (bufAhead > 0.5) {
        signalInd.className = 'signal-indicator medium';
        signalText.textContent = 'GOOD';
      } else {
        signalInd.className = 'signal-indicator weak';
        signalText.textContent = 'POOR';
      }
    }
  }, 2000);
}

// ── Timecode (HUD) ────────────────────────────────────────
function startTimecode() {
  clearInterval(timecodeInterval);
  const start = Date.now();

  timecodeInterval = setInterval(() => {
    const elapsed   = Date.now() - start;
    const totalSec  = Math.floor(elapsed / 1000);
    const h  = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m  = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s  = String(totalSec % 60).padStart(2, '0');
    const f  = String(Math.floor((elapsed % 1000) / (1000 / 30))).padStart(2, '0');
    hudTimecode.textContent = `${h}:${m}:${s}:${f}`;
  }, 1000 / 30);
}

// ── Uptime ticker ─────────────────────────────────────────
let uptimeInterval = null;

function startUptimeTicker() {
  clearInterval(uptimeInterval);
  uptimeInterval = setInterval(() => {
    if (!liveStartTime) return;
    const elapsed = Math.floor((Date.now() - liveStartTime) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    teleUptime.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

// ── HTTP-FLV player ───────────────────────────────────────
function initPlayer() {
  destroyPlayer();
  showLoading();

  if (!mpegts.isSupported()) {
    console.error('[FLV] flv.js not supported in this browser');
    showOffline();
    return;
  }

  flvPlayer = mpegts.createPlayer(
    { type: 'flv', url: CONFIG.flvUrl, isLive: true },
    {
      enableWorker:        true,
      lazyLoad:            false,
      lazyLoadMaxDuration: 3,
      // Keep the live edge: drop stale buffered data
      stashInitialSize:    128,
      // Reconnect on network errors
      enableStashBuffer:   false,
    }
  );

  flvPlayer.attachMediaElement(video);
  flvPlayer.load();
  video.play().catch(() => {});

  flvPlayer.on(mpegts.Events.ERROR, (errType, errDetail) => {
    console.error('[FLV] error', errType, errDetail);
    showOffline();
    scheduleRetry();
  });

  flvPlayer.on(mpegts.Events.STATISTICS_INFO, () => {});
}

// ── Video element events ──────────────────────────────────
video.addEventListener('playing', () => {
  showLive();
  startUptimeTicker();
  viewerQuality.textContent = 'HTTP-FLV';
});

video.addEventListener('waiting', () => {
  // Brief stall — don't go offline immediately, just show connecting
  connectingBadge.classList.remove('hidden');
  liveBadge.classList.add('hidden');
});

video.addEventListener('playing', () => {
  connectingBadge.classList.add('hidden');
  liveBadge.classList.remove('hidden');
}, true);

// ── Retry button ──────────────────────────────────────────
retryBtn.addEventListener('click', initPlayer);

// ── Start ─────────────────────────────────────────────────
initPlayer();

// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTIVE COMMAND PANEL
// Sends viewer commands to the sandbox backend → tmux session
// ═══════════════════════════════════════════════════════════════════════════════

const CMD_CONFIG = {
  // Relative URL — routed through nginx on the same host:port as the page.
  // This means no extra firewall rules are needed and it works from any machine.
  apiBase: '',
  cooldown: 2000, // ms — must match backend RATE_LIMIT
};

// ── DOM refs (command panel) ─────────────────────────────
const cmdInput       = document.getElementById('cmd-input');
const cmdSendBtn     = document.getElementById('cmd-send');
const cmdFeedback    = document.getElementById('cmd-feedback');
const cmdHistory     = document.getElementById('cmd-history');
const cmdCooldownBar = document.getElementById('cmd-cooldown-bar');
const cmdRateBadge   = document.getElementById('cmd-rate');
const cmdWlToggle    = document.getElementById('cmd-whitelist-toggle');
const cmdWlContainer = document.getElementById('cmd-whitelist');

// Username
const usernameModal   = document.getElementById('username-modal');
const usernameInput   = document.getElementById('username-input');
const usernameSubmit  = document.getElementById('username-submit');
const usernameDisplay = document.getElementById('username-display');
const usernameRename  = document.getElementById('username-rename');

// User list
const cmdUsersList  = document.getElementById('cmd-users-list');
const cmdUsersCount = document.getElementById('cmd-users-count');

let cmdCooldownTimer = null;
let cmdOnCooldown    = false;

// ── Username management ──────────────────────────────────
const USERNAME_KEY = 'stream_username';

function getUsername() {
  return localStorage.getItem(USERNAME_KEY) || '';
}

function saveUsername(name) {
  localStorage.setItem(USERNAME_KEY, name);
  usernameDisplay.textContent = name;
}

function openUsernameModal() {
  usernameInput.value = getUsername();
  usernameModal.classList.remove('hidden');
  setTimeout(() => usernameInput.focus(), 50);
}

function closeUsernameModal() {
  usernameModal.classList.add('hidden');
}

function submitUsername() {
  const raw     = usernameInput.value.trim();
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 20);
  if (!cleaned) return;
  saveUsername(cleaned);
  closeUsernameModal();
}

usernameSubmit.addEventListener('click', submitUsername);
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitUsername();
  if (e.key === 'Escape' && getUsername()) closeUsernameModal();
});
usernameRename.addEventListener('click', openUsernameModal);

// Show modal on first visit; otherwise just update display
if (!getUsername()) {
  openUsernameModal();
} else {
  usernameDisplay.textContent = getUsername();
}

// ── Send command ──────────────────────────────────────────
async function sendCommand() {
  const cmd = cmdInput.value.trim();
  if (!cmd || cmdOnCooldown) return;

  cmdSendBtn.disabled = true;
  cmdInput.disabled   = true;

  try {
    const resp = await fetch(`${CMD_CONFIG.apiBase}/api/command`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ command: cmd }),
    });

    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data.ok) {
      showCmdFeedback(`✓ Executed: ${cmd}`, 'success');
      addHistoryEntry(cmd);
      cmdInput.value = '';
      startCooldown();
    } else {
      showCmdFeedback(`✗ ${data.error || 'Unknown error'}`, 'error');
      cmdSendBtn.disabled = false;
      cmdInput.disabled   = false;
    }
  } catch (err) {
    showCmdFeedback('✗ Backend unreachable — is the sandbox container running?', 'error');
    cmdSendBtn.disabled = false;
    cmdInput.disabled   = false;
  }

  cmdInput.focus();
}

// ── Cooldown bar animation ────────────────────────────────
function startCooldown() {
  cmdOnCooldown = true;
  cmdRateBadge.textContent = 'COOLDOWN';
  cmdRateBadge.classList.remove('queued');
  cmdRateBadge.classList.add('cooldown');
  cmdCooldownBar.style.transition = 'none';
  cmdCooldownBar.style.width = '100%';

  // Force reflow then animate to 0
  void cmdCooldownBar.offsetWidth;
  cmdCooldownBar.style.transition = `width ${CMD_CONFIG.cooldown}ms linear`;
  cmdCooldownBar.style.width = '0%';

  clearTimeout(cmdCooldownTimer);
  cmdCooldownTimer = setTimeout(() => {
    cmdOnCooldown = false;
    cmdSendBtn.disabled = false;
    cmdInterruptBtn.disabled = false;
    cmdInput.disabled   = false;
    cmdRateBadge.textContent = 'READY';
    cmdRateBadge.classList.remove('cooldown');
    cmdInput.focus();
  }, CMD_CONFIG.cooldown);
}

// ── Feedback toast ────────────────────────────────────────
let feedbackTimeout = null;
function showCmdFeedback(msg, type) {
  clearTimeout(feedbackTimeout);
  cmdFeedback.textContent = msg;
  cmdFeedback.className   = `cmd-feedback visible ${type}`;
  feedbackTimeout = setTimeout(() => {
    cmdFeedback.className = 'cmd-feedback';
  }, 4000);
}

// ── History list ──────────────────────────────────────────
function addHistoryEntry(cmd, username) {
  // Remove the "empty" placeholder
  const empty = cmdHistory.querySelector('.cmd-history-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = 'cmd-entry';

  const now = new Date();
  const ts = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join(':');

  const userTag = username
    ? `<span class="cmd-entry-user">${escapeHtml(username)}</span>`
    : '';

  entry.innerHTML = `
    <div class="cmd-entry-left">
      ${userTag}
      <span class="cmd-entry-prompt">❯</span>
      <span class="cmd-entry-text">${escapeHtml(cmd)}</span>
    </div>
    <span class="cmd-entry-time">${ts}</span>
  `;

  // Click to re-populate input
  entry.addEventListener('click', () => {
    cmdInput.value = cmd;
    cmdInput.focus();
  });

  cmdHistory.prepend(entry);

  // Cap visible entries
  while (cmdHistory.children.length > 30) {
    cmdHistory.removeChild(cmdHistory.lastChild);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Whitelist panel ───────────────────────────────────────
async function loadWhitelist() {
  try {
    const resp = await fetch(`${CMD_CONFIG.apiBase}/api/whitelist`);
    const data = await resp.json();
    if (data.commands) {
      cmdWlContainer.innerHTML = data.commands
        .map((c) => `<span class="cmd-wl-tag">${c}</span>`)
        .join('');
    }
  } catch {
    cmdWlContainer.innerHTML =
      '<span style="color:var(--text-muted);font-size:0.65rem;">Could not load whitelist</span>';
  }
}

cmdWlToggle.addEventListener('click', () => {
  const isOpen = cmdWlContainer.classList.toggle('open');
  cmdWlToggle.textContent = isOpen ? 'ALLOWED COMMANDS ▴' : 'ALLOWED COMMANDS ▾';
  if (isOpen && cmdWlContainer.children.length === 0) {
    loadWhitelist();
  }
});

// ── Send interrupt (Ctrl+C) ─────────────────────────────
const cmdInterruptBtn = document.getElementById('cmd-interrupt');

async function sendInterrupt() {
  if (cmdOnCooldown) return;
  const username = getUsername();
  if (!username) { openUsernameModal(); return; }

  cmdInterruptBtn.disabled = true;

  try {
    const resp = await fetch(`${CMD_CONFIG.apiBase}/api/interrupt`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username }),
    });

    const data = await resp.json().catch(() => ({}));

    if (resp.ok && data.ok) {
      showCmdFeedback('✓ Sent ^C (interrupt)', 'success');
      addHistoryEntry('^C', username);
      startCooldown();
    } else {
      showCmdFeedback(`✗ ${data.error || 'Unknown error'}`, 'error');
      cmdInterruptBtn.disabled = false;
    }
  } catch (err) {
    showCmdFeedback('✗ Backend unreachable — is the sandbox container running?', 'error');
    cmdInterruptBtn.disabled = false;
  }
}

cmdInterruptBtn.addEventListener('click', sendInterrupt);

// ── Event listeners ───────────────────────────────────────
cmdSendBtn.addEventListener('click', sendCommand);

cmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendCommand();
  }
});

// Clicking a whitelist tag fills the input
cmdWlContainer.addEventListener('click', (e) => {
  if (e.target.classList.contains('cmd-wl-tag')) {
    cmdInput.value = e.target.textContent + ' ';
    cmdInput.focus();
  }
});

// ── Online user list ───────────────────────────────────────
async function refreshUserList() {
  try {
    const resp = await fetch(`${CMD_CONFIG.apiBase}/api/users`);
    const data = await resp.json();
    const me   = getUsername();

    cmdUsersCount.textContent = data.count || 0;

    if (!data.users || data.users.length === 0) {
      cmdUsersList.innerHTML = '<span class="cmd-users-empty">No active users</span>';
      return;
    }

    cmdUsersList.innerHTML = data.users
      .map((u) => {
        const isSelf = u === me;
        return `<span class="cmd-user-chip${isSelf ? ' is-self' : ''}">${escapeHtml(u)}${isSelf ? ' <em>(you)</em>' : ''}</span>`;
      })
      .join('');
  } catch {
    // silently ignore — network may not be ready yet
  }
}

refreshUserList();
setInterval(refreshUserList, 15_000);

// ── Heartbeat ──────────────────────────────────────────────
function sendHeartbeat() {
  const username = getUsername();
  if (!username) return;
  fetch(`${CMD_CONFIG.apiBase}/api/heartbeat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username }),
  }).catch(() => {});
}

sendHeartbeat();
setInterval(sendHeartbeat, 30_000);

