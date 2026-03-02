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
  // WHEP endpoint exposed by SRS.
  // Pattern: http://<server>:1985/rtc/v1/whep/?app=<app>&stream=<key>
  // <app> and <stream> must match your OBS stream key.
  // OBS URL  → rtmp://<server>/live
  // OBS key  → livestream   (or whatever you set)
  // Uses the current page hostname so it works from localhost or any other address.
  whepUrl: `http://${window.location.hostname}:1985/rtc/v1/whep/?app=live&stream=test`,

  // Human-readable title shown below the player.
  streamTitle: 'Live Stream',

  // How often (ms) to retry when the stream is offline / connection drops.
  retryInterval: 3000,

  // ICE gathering timeout (ms) before sending the offer anyway.
  iceTimeout: 2000,
};

// ── DOM refs ──────────────────────────────────────────────
const video            = document.getElementById('video-player');
const playerWrapper    = document.getElementById('player-wrapper');
const overlay          = document.getElementById('overlay');
const loadingSpinner   = document.getElementById('loading-spinner');
const offlineMsg       = document.getElementById('offline-message');
const liveBadge        = document.getElementById('live-badge');
const retryBtn         = document.getElementById('retry-btn');
const streamTitleEl    = document.getElementById('stream-title');
const streamUrlDisplay = document.getElementById('stream-url-display');
const viewerQuality    = document.getElementById('viewer-quality');
const clockEl          = document.getElementById('clock');

// ── Init UI ───────────────────────────────────────────────
streamTitleEl.textContent    = CONFIG.streamTitle;
streamUrlDisplay.textContent = CONFIG.whepUrl;
document.title               = CONFIG.streamTitle;

// ── Low-latency video hints ───────────────────────────────
// Minimize browser-side buffering
video.preload = 'none';
if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
  // Prefer fastest rendering path when available
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
let pc         = null;
let retryTimer = null;

// ── UI helpers ────────────────────────────────────────────
function showLoading() {
  overlay.classList.remove('hidden');
  loadingSpinner.classList.remove('hidden');
  offlineMsg.classList.add('hidden');
  liveBadge.classList.add('hidden');
  playerWrapper.classList.remove('is-live');
}

function showOffline() {
  overlay.classList.remove('hidden');
  loadingSpinner.classList.add('hidden');
  offlineMsg.classList.remove('hidden');
  liveBadge.classList.add('hidden');
  viewerQuality.classList.add('hidden');
  playerWrapper.classList.remove('is-live');
}

function showLive() {
  overlay.classList.add('hidden');
  liveBadge.classList.remove('hidden');
  viewerQuality.classList.remove('hidden');
  playerWrapper.classList.add('is-live');
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(initPlayer, CONFIG.retryInterval);
}

function destroyPc() {
  clearTimeout(retryTimer);
  if (pc) {
    pc.close();
    pc = null;
  }
  video.srcObject = null;
}

// ── SRS play via /rtc/v1/play/ ────────────────────────────
// SRS uses its own JSON API, not raw WHEP.
// We send the SDP offer as JSON and get a JSON answer back.
// The offer must be fully gathered (BUNDLE group present) before sending.
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

// Parse  http://host:1985/rtc/v1/whep/?app=live&stream=test
// → POST http://host:1985/rtc/v1/play/
// → body { sdp, streamurl, clientip }
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

    // Receive-only — we never send media back
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    // Attach incoming stream to the <video> element
    pc.ontrack = ({ streams }) => {
      if (streams[0] && video.srcObject !== streams[0]) {
        video.srcObject = streams[0];
        video.play().catch((e) => console.warn('[WebRTC] autoplay blocked:', e));
      }
    };

    const thisPc = pc;
    pc.onconnectionstatechange = () => {
      if (pc !== thisPc) return;          // stale handler from a previous attempt
      console.log('[WebRTC] state →', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        showOffline();
        scheduleRetry();
      }
    };

    // Build offer and wait for full ICE gathering so BUNDLE group is in the SDP
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

    // showLive() fires from the 'playing' event below

  } catch (err) {
    console.error('[WebRTC]', err);
    showOffline();
    scheduleRetry();
  }
}

// ── Video events ──────────────────────────────────────────
video.addEventListener('playing', () => {
  showLive();
  viewerQuality.textContent = 'WEBRTC';
});

// ── Retry button ──────────────────────────────────────────
retryBtn.addEventListener('click', initPlayer);

// ── Start ─────────────────────────────────────────────────
initPlayer();
