/**
 * Streaming frontend – app.js
 * Protocol : WebRTC via WHEP (WebRTC-HTTP Egress Protocol)
 * Server   : SRS (Simple Realtime Server)
 *
 * ── HOW IT WORKS ─────────────────────────────────────────────────────────────
 * 1. Browser creates an RTCPeerConnection and builds an SDP offer.
 * 2. The offer is POST-ed to SRS's WHEP HTTP endpoint.
 * 3. SRS replies with an SDP answer.
 * 4. ICE + DTLS handshake completes over UDP.
 * 5. Video/audio stream at <1 s latency, no plugins needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONFIG = {
  whepUrl: `http://${window.location.hostname}:1985/rtc/v1/whep/?app=live&stream=test`,
  streamTitle: 'Live Stream',
  retryInterval: 3000,
  iceTimeout: 2000,
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
streamUrlDisplay.textContent = CONFIG.whepUrl;
document.title               = CONFIG.streamTitle;

// ── Low-latency video hints ───────────────────────────────
video.preload = 'none';
if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
  video.style.contentVisibility = 'auto';
}

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
let pc              = null;
let retryTimer      = null;
let liveStartTime   = null;
let statsInterval   = null;
let timecodeInterval= null;
let frameCount      = 0;

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
    '<span class="footer-status-dot" style="background:var(--cyan);box-shadow:0 0 8px rgba(56,217,232,0.4)"></span> CONNECTING';
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

  // Reset telemetry
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
    '<span class="footer-status-dot" style="background:#2ecc71;box-shadow:0 0 8px rgba(46,204,113,0.5)"></span> STREAM ACTIVE';

  liveStartTime = Date.now();
  startTelemetry();
  startTimecode();
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(initPlayer, CONFIG.retryInterval);
}

function destroyPc() {
  clearTimeout(retryTimer);
  clearInterval(statsInterval);
  clearInterval(timecodeInterval);
  clearInterval(uptimeInterval);
  if (pc) {
    pc.close();
    pc = null;
  }
  video.srcObject = null;
}

// ── Telemetry (frames, codec, bitrate, signal) ───────────
function startTelemetry() {
  clearInterval(statsInterval);

  statsInterval = setInterval(async () => {
    if (!pc) return;
    try {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          if (report.framesDecoded !== undefined) {
            frameCount = report.framesDecoded;
            teleFrames.textContent = frameCount.toLocaleString();
          }
          if (report.codecId) {
            stats.forEach((cr) => {
              if (cr.id === report.codecId && cr.mimeType) {
                teleCodec.textContent = cr.mimeType.replace('video/', '').toUpperCase();
              }
            });
          }
          if (report.bytesReceived !== undefined && report.timestamp) {
            if (!showLive._lastBytes) {
              showLive._lastBytes = report.bytesReceived;
              showLive._lastTs    = report.timestamp;
            } else {
              const dBytes = report.bytesReceived - showLive._lastBytes;
              const dTime  = (report.timestamp - showLive._lastTs) / 1000;
              if (dTime > 0) {
                const kbps = Math.round((dBytes * 8) / dTime / 1000);
                hudBitrate.textContent = `${kbps} kbps`;
              }
              showLive._lastBytes = report.bytesReceived;
              showLive._lastTs    = report.timestamp;
            }
          }
          if (report.frameWidth && report.frameHeight) {
            hudRes.textContent = `${report.frameWidth}×${report.frameHeight}`;
          }
          if (report.packetsReceived !== undefined && report.packetsLost !== undefined) {
            const total = report.packetsReceived + report.packetsLost;
            const lossRate = total > 0 ? report.packetsLost / total : 0;
            if (lossRate < 0.01) {
              signalInd.className = 'signal-indicator strong';
              signalText.textContent = 'EXCELLENT';
            } else if (lossRate < 0.05) {
              signalInd.className = 'signal-indicator medium';
              signalText.textContent = 'GOOD';
            } else {
              signalInd.className = 'signal-indicator weak';
              signalText.textContent = 'POOR';
            }
          }
        }
      });
    } catch (e) { /* stats not available yet */ }
  }, 2000);
}

// ── Timecode (HUD) ─────────────────────────────────────────
function startTimecode() {
  clearInterval(timecodeInterval);
  const start = Date.now();
  let frame = 0;

  timecodeInterval = setInterval(() => {
    const elapsed = Date.now() - start;
    const totalSec = Math.floor(elapsed / 1000);
    const h  = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m  = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s  = String(totalSec % 60).padStart(2, '0');
    const f  = String(Math.floor((elapsed % 1000) / (1000 / 30))).padStart(2, '0');
    hudTimecode.textContent = `${h}:${m}:${s}:${f}`;
  }, 1000 / 30); // ~30fps timecode
}

// ── Uptime ticker (separate so we can clear reliably) ────
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

// ── SRS play via /rtc/v1/play/ ────────────────────────────
function waitForIce(peerConnection) {
  return new Promise((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, CONFIG.iceTimeout);
    peerConnection.addEventListener('icegatheringstatechange', function handler() {
      if (peerConnection.iceGatheringState === 'complete') {
        clearTimeout(timer);
        peerConnection.removeEventListener('icegatheringstatechange', handler);
        resolve();
      }
    });
  });
}

function buildPlayUrl(whepUrl) {
  const u = new URL(whepUrl);
  const app    = u.searchParams.get('app')    || 'live';
  const stream = u.searchParams.get('stream') || 'livestream';
  const playApi = `${u.protocol}//${u.host}/rtc/v1/play/`;
  const streamUrl = `webrtc://${u.hostname}/${app}/${stream}`;
  return { playApi, streamUrl };
}

async function initPlayer() {
  destroyPc();
  showLoading();

  try {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      bundlePolicy: 'max-bundle',
    });

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = ({ streams }) => {
      if (streams[0] && video.srcObject !== streams[0]) {
        video.srcObject = streams[0];
        video.play().catch((e) => console.warn('[WebRTC] autoplay blocked:', e));
      }
    };

    const thisPc = pc;
    pc.onconnectionstatechange = () => {
      if (pc !== thisPc) return;
      console.log('[WebRTC] state →', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        showOffline();
        scheduleRetry();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);

    const { playApi, streamUrl } = buildPlayUrl(CONFIG.whepUrl);
    console.log('[WebRTC] POST', playApi, '→', streamUrl);

    const resp = await fetch(playApi, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sdp:       pc.localDescription.sdp,
        streamurl: streamUrl,
        clientip:  null,
      }),
    });

    const json = await resp.json().catch(() => ({}));
    console.log('[WebRTC] SRS response:', json);

    if (!resp.ok || json.code !== 0) {
      throw new Error(`SRS error ${json.code}: ${json.error || resp.statusText}`);
    }

    await pc.setRemoteDescription({ type: 'answer', sdp: json.sdp });

  } catch (err) {
    console.error('[WebRTC]', err);
    showOffline();
    scheduleRetry();
  }
}

// ── Video events ──────────────────────────────────────────
video.addEventListener('playing', () => {
  showLive();
  startUptimeTicker();
  viewerQuality.textContent = 'WEBRTC';

  // Reset HUD stat caches
  showLive._lastBytes = null;
  showLive._lastTs    = null;
});

// ── Retry button ──────────────────────────────────────────
retryBtn.addEventListener('click', initPlayer);

// ── Start ─────────────────────────────────────────────────
initPlayer();
