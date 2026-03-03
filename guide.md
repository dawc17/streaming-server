# Streaming Server — Quick Reference

## Overview

```
OBS  ──RTMP──▶  SRS (1935)  ──WebRTC/WHEP──▶  Browser (8080)
                                                    │
                                             nginx (8080)
                                             ├─ /          → frontend
                                             ├─ /stream/   → frontend (alias)
                                             └─ /api/      → sandbox:3000
                                                    │
                                             sandbox container
                                             ├─ Flask API (3000, internal only)
                                             └─ tmux session "main"  ◀── OBS captures this
```

---

## Starting / Stopping

```powershell
# Start everything (from project folder)
docker compose up -d

# Start and rebuild the sandbox image (after editing backend/)
docker compose up -d --build

# Stop everything
docker compose down

# Restart a single service (e.g. after editing nginx-frontend.conf)
docker compose restart nginx

# View live logs for all containers
docker compose logs -f

# View logs for one container
docker compose logs -f sandbox
```

---

## Attach to the tmux terminal (what OBS captures)

```powershell
docker exec -it streaming-server-sandbox-1 tmux attach -t main
```

> **Detach without stopping:** `Ctrl-B` then `D`

---

## OBS Settings

| Setting    | Value                        |
| ---------- | ---------------------------- |
| Service    | Custom                       |
| Server     | `rtmp://<HOST-IP>:1935/live` |
| Stream Key | `test`                       |

Viewers open: `http://<HOST-IP>:8080/stream/`

> Replace `<HOST-IP>` with your LAN IP (check with `ipconfig`).
> Update `CANDIDATE` in `docker-compose.yml` to match if WebRTC is broken.

---

## Ports at a glance

| Port   | Protocol | Purpose                      | Exposed to LAN?  |
| ------ | -------- | ---------------------------- | ---------------- |
| `1935` | TCP      | RTMP ingest (OBS)            | ✅               |
| `1985` | TCP      | SRS HTTP API / WHEP          | ✅               |
| `8000` | UDP      | WebRTC media                 | ✅               |
| `8080` | TCP      | Frontend + API proxy (nginx) | ✅               |
| `3000` | TCP      | Command API (Flask)          | ❌ internal only |

---

## API endpoints (via nginx → http://HOST:8080)

```bash
# Health check
curl http://localhost:8080/api/health

# Send a command to the tmux session
curl -X POST http://localhost:8080/api/command \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la"}'

# View recent command history
curl http://localhost:8080/api/history

# View whitelisted commands
curl http://localhost:8080/api/whitelist
```

---

## Sandbox content (practice files)

All files live in `/sandbox/` inside the container:

```
/sandbox/
├── documents/
│   ├── welcome.txt
│   ├── readme.txt
│   ├── fruits.txt
│   └── employees.csv
└── scripts/
    ├── hello.sh
    └── loop.sh
```

To add/edit files without rebuilding:

```powershell
docker exec -it streaming-server-sandbox-1 bash
# then edit freely — changes are lost on container restart
```

To persist new files, edit `backend/Dockerfile` and rebuild.

---

## Tuning the command API (`backend/server.py`)

| Variable           | Default      | What it does                                      |
| ------------------ | ------------ | ------------------------------------------------- |
| `RATE_LIMIT`       | `2` sec      | Min gap between commands                          |
| `MAX_CMD_LEN`      | `200`        | Max command length                                |
| `ALLOWED_COMMANDS` | ~70 commands | Whitelist of safe base commands                   |
| `BLOCKED_PATTERNS` | regex list   | Hard-blocked patterns (rm -rf /, fork bomb, etc.) |

After editing server.py:

```powershell
docker compose up -d --build
```

---

## Changing the host IP (CANDIDATE)

If WebRTC video doesn't load, update the IP in `docker-compose.yml`:

```yaml
environment:
  - CANDIDATE=<YOUR-LAN-IP>
```

Then:

```powershell
docker compose up -d
```

---

## Troubleshooting

**Video doesn't load / stays on "OFF AIR"**

- Check OBS is streaming to `rtmp://<IP>:1935/live` with key `test`
- Verify `CANDIDATE` IP matches your LAN IP
- Open browser console — look for WebRTC ICE errors

**Commands time out from another machine**

- All API calls go through port `8080` (nginx). Make sure that port is allowed in Windows Firewall.
- Port `3000` is internal-only by design — do not expose it.

**`error during connect` / `cannot find the file specified`**

Docker Desktop is not running. Start it from the Start Menu or:

```powershell
Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
```

Wait for the whale icon in the system tray to stop animating, then retry.

---

**Sandbox container keeps restarting**

```powershell
docker compose logs sandbox
```

**Rebuild from scratch**

```powershell
docker compose down
docker compose build --no-cache
docker compose up -d
```
