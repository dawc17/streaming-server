# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

A **livestreamed interactive terminal** for teaching Linux commands. Viewers watch a tmux session (captured by OBS) via an HTTP-FLV stream, and send commands through a web UI. Commands are validated, queued, and injected into the terminal. Recordings (VOD) are automatically saved and browsable in the UI.

## Running the Project

```bash
# Start all containers
docker compose -f config/docker-compose.yml up -d

# Rebuild after backend changes
docker compose -f config/docker-compose.yml up -d --build

# Reload nginx config
docker compose -f config/docker-compose.yml restart nginx

# View sandbox logs
docker compose -f config/docker-compose.yml logs -f sandbox
```

There is **no build step** — the frontend is vanilla HTML/CSS/JS served directly by nginx.

## Architecture

Three Docker containers orchestrated via `config/docker-compose.yml`:

```
OBS (RTMP on 1935) → [SRS] → HTTP-FLV / WebRTC / DVR
                              ↓
Browser (port 8080) ← [nginx] → /live/* → SRS HTTP-FLV
                              ↓           /vods/* → recorded files
                        /api/* → [Sandbox Flask :3000]
                                  ↓
                               tmux session "main" (learner user)
                               ← commands injected here
```

**SRS container** (`ossrs/srs:5`): Ingests RTMP, remuxes to HTTP-FLV, handles WebRTC/WHEP, records DVR segments to `/vods/` volume.

**nginx container**: Single public port 8080. Routes frontend static files, proxies `/api/*` to Flask, `/live/*` to SRS HTTP stream, `/vods/*` to recordings.

**Sandbox container** (custom Ubuntu 22.04): Dual-purpose — runs the tmux terminal that OBS captures for the stream, AND hosts the Flask API on `:3000` (internal only). The `learner` user is sandboxed to `/sandbox/`.

## Key Files

- `backend/server.py` — Flask API: command validation/queuing, user tracking, VOD management
- `frontend/js/app.js` — ~700 lines: mpegts.js player, command panel, VOD library, user tracking
- `frontend/css/style.css` — ~1200 lines: hacker terminal aesthetic (phosphor green, CRT effects)
- `config/nginx-frontend.conf` — All routing rules (the single-port proxy setup)
- `config/srs.conf` — SRS streaming server config
- `backend/entrypoint.sh` — Starts tmux session, injects welcome banner, launches Flask

## Backend API (`backend/server.py`)

Commands go through a queue with a daemon worker thread. Key safety mechanisms:
- **Whitelist**: ~70 allowed base commands (`ls`, `cat`, `grep`, etc.)
- **Blocked patterns**: Regex blocks for destructive/escape commands
- **Rate limit**: 2 seconds between commands (configurable via `COMMAND_DELAY_SECONDS` env var)

Routes: `POST /api/command`, `POST /api/interrupt`, `POST /api/heartbeat`, `GET /api/users`, `GET /api/history`, `GET /api/whitelist`, `GET /api/vods`, `GET /api/vods/stats`, `DELETE /api/vods/<path>`

## Frontend (`frontend/js/app.js`)

- Username stored in `localStorage`, prompted on first visit
- Heartbeat sent every 30s; users visible in online list for 60s
- Cooldown bar shows rate-limit status visually
- VOD library uses a second mpegts.js instance in a modal
- Stream reconnect logic with exponential-ish retry

## Design Conventions

- **Aesthetic**: Retro hacker/terminal — phosphor green `#00ff41`, dark void background, scanlines, CRT flicker
- **Fonts**: VT323 (titles/display), Share Tech Mono (body)
- No CSS frameworks, no JS frameworks — pure vanilla
