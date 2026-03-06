"""
Interactive Linux Learning – Command API
Receives commands via HTTP, validates against a whitelist,
and injects them into the running tmux session so viewers
see real execution on the livestream.
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import re
import time
import threading
from collections import deque

app = Flask(__name__)
CORS(app)

# ── Configuration ──────────────────────────────────────────
TMUX_SESSION = "main"
RATE_LIMIT   = 2        # seconds between commands
MAX_CMD_LEN  = 200      # max characters per command
HISTORY_SIZE = 50       # commands to keep in memory
MAX_QUEUE    = 10       # max commands waiting in queue
USER_TIMEOUT = 60       # seconds before user is considered offline

# ── Whitelisted base commands ──────────────────────────────
ALLOWED_COMMANDS = {
    # Navigation & listing
    "ls", "cd", "pwd", "tree", "dir",
    # File reading
    "cat", "head", "tail", "less", "more", "wc", "file", "stat",
    # File manipulation
    "touch", "mkdir", "rmdir", "cp", "mv", "rm", "ln",
    # Text output
    "echo", "printf",
    # Search & filter
    "grep", "egrep", "fgrep", "find", "which", "whereis", "locate",
    # Text processing
    "sort", "uniq", "cut", "tr", "awk", "sed", "diff", "comm",
    "paste", "tee", "xargs",
    # System info
    "whoami", "hostname", "date", "cal", "df", "du", "free",
    "uname", "uptime", "ps", "top", "htop", "id", "groups", "lsb_release",
    # Networking basics
    "ping", "curl", "wget", "ifconfig", "ip", "ss", "netstat",
    "host", "dig", "nslookup",
    # Permissions
    "chmod", "chown",
    # Archives
    "tar", "gzip", "gunzip", "zip", "unzip",
    # Package management (learning)
    "apt", "dpkg",
    # Misc
    "clear", "history", "man", "help", "alias", "env", "export",
    "printenv", "set", "type", "true", "false", "yes", "seq",
    "sleep", "watch", "tput", "reset",
}

# ── Blocked patterns (even if base command is allowed) ─────
BLOCKED_PATTERNS = [
    r"rm\s+(-[a-zA-Z]*)?/\s*$",         # rm / or rm -rf /
    r"rm\s+-[a-zA-Z]*r[a-zA-Z]*\s+/\s", # rm -rf /...
    r"mkfs",                              # format disks
    r"dd\s+if=",                          # raw disk writes
    r":\(\)\s*\{",                        # fork bomb
    r">\s*/dev/sd",                       # overwrite disks
    r">\s*/dev/null.*<\s*/dev/",          # device abuse
    r"shutdown",
    r"reboot",
    r"halt",
    r"poweroff",
    r"init\s+[06]",
    r"systemctl\s+(poweroff|reboot|halt)",
    r"\brm\s+-rf\s+/\b",
    r"curl.*\|\s*(ba)?sh",               # pipe to shell
    r"wget.*\|\s*(ba)?sh",
    r"python.*-c.*import\s+os",          # python shell escapes
    r"perl\s+-e",
    r"ruby\s+-e",
    r"nc\s+-[a-zA-Z]*l",                 # netcat listeners
]

# ── State ──────────────────────────────────────────────────
command_history: deque = deque(maxlen=HISTORY_SIZE)
# username → {ip, last_seen, first_seen, cmd_count}
active_users: dict     = {}

# ── Command queue ──────────────────────────────────────────
_queue:        deque            = deque()
_queue_lock:   threading.Lock   = threading.Lock()
_queue_thread: threading.Thread = None
_last_exec:    list             = [0.0]   # mutable so worker can update it


class _QueueItem:
    def __init__(self, command, username, ip, interrupt=False):
        self.command   = command
        self.username  = username
        self.ip        = ip
        self.interrupt = interrupt
        self.event     = threading.Event()
        self.result    = None


def _run_queue():
    global _queue_thread
    while True:
        with _queue_lock:
            if not _queue:
                _queue_thread = None
                return
            item = _queue.popleft()

        # Honour rate-limit gap between executions
        gap = RATE_LIMIT - (time.time() - _last_exec[0])
        if gap > 0:
            time.sleep(gap)

        try:
            if item.interrupt:
                subprocess.run(
                    ["tmux", "send-keys", "-t", TMUX_SESSION, "C-c"],
                    check=True, timeout=5,
                )
                label = "^C"
            else:
                subprocess.run(
                    ["tmux", "send-keys", "-t", TMUX_SESSION, item.command, "Enter"],
                    check=True, timeout=5,
                )
                label = item.command

            _last_exec[0] = time.time()
            command_history.append({
                "command":   label,
                "timestamp": time.strftime("%H:%M:%S"),
                "username":  item.username or "anon",
                "user":      item.ip,
            })
            item.result = {"ok": True, "command": label}

        except subprocess.CalledProcessError as exc:
            item.result = {"ok": False, "error": f"tmux error: {exc}"}
        except subprocess.TimeoutExpired:
            item.result = {"ok": False, "error": "Command timed out"}

        item.event.set()


def _enqueue(item: _QueueItem):
    """Add item to queue, start worker thread if needed.
    Returns queue position (1-based) or None if queue is full."""
    global _queue_thread
    with _queue_lock:
        if len(_queue) >= MAX_QUEUE:
            return None
        _queue.append(item)
        position = len(_queue)
        if _queue_thread is None or not _queue_thread.is_alive():
            _queue_thread = threading.Thread(target=_run_queue, daemon=True)
            _queue_thread.start()
        return position


def _clean_username(raw) -> str:
    """Sanitise a username. Returns empty string if nothing usable was provided."""
    return re.sub(r"[^a-zA-Z0-9_\-]", "", (raw or "").strip())[:20]


def _touch_user(username: str, ip: str, command: bool = False) -> None:
    """Update or create a user record. No-op if username is empty."""
    if not username:
        return
    now = time.time()
    if username in active_users:
        active_users[username]["ip"]        = ip
        active_users[username]["last_seen"] = now
        if command:
            active_users[username]["cmd_count"] += 1
    else:
        active_users[username] = {
            "ip":          ip,
            "first_seen":  now,
            "last_seen":   now,
            "cmd_count":   1 if command else 0,
        }


def extract_base_command(segment: str) -> str:
    """Extract the base command name from a command segment."""
    segment = segment.strip()
    # Skip env variable assignments like FOO=bar cmd
    while "=" in segment.split()[0] if segment.split() else False:
        segment = segment.split(None, 1)[1] if " " in segment else ""
    parts = segment.split()
    if not parts:
        return ""
    base = parts[0]
    # Strip any path prefix  ./script  /usr/bin/ls → ls
    base = base.rsplit("/", 1)[-1]
    return base


def is_command_safe(cmd: str) -> tuple[bool, str]:
    """Validate a command against whitelist and blocked patterns."""
    cmd = cmd.strip()
    if not cmd:
        return False, "Empty command"

    # Check blocked patterns first
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, cmd, re.IGNORECASE):
            return False, "Command blocked for safety"

    # Split on pipes, &&, ||, ; and validate each segment
    segments = re.split(r"\s*(?:\|{1,2}|&&|;)\s*", cmd)
    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue
        base = extract_base_command(segment)
        if not base:
            continue
        if base not in ALLOWED_COMMANDS:
            return False, f"Command '{base}' is not in the whitelist"

    return True, "OK"


# ── Routes ─────────────────────────────────────────────────

@app.route("/api/command", methods=["POST"])
def execute_command():
    """Validate a command, queue it, and wait for the result."""
    data = request.get_json(silent=True)
    if not data or "command" not in data:
        return jsonify({"ok": False, "error": "Missing 'command' field"}), 400

    cmd      = data["command"].strip()
    username = _clean_username(data.get("username", ""))

    if len(cmd) > MAX_CMD_LEN:
        return jsonify({"ok": False, "error": f"Command too long (max {MAX_CMD_LEN} chars)"}), 400

    safe, reason = is_command_safe(cmd)
    if not safe:
        return jsonify({"ok": False, "error": reason}), 403

    _touch_user(username, request.remote_addr, command=True)

    item = _QueueItem(cmd, username, request.remote_addr)
    pos  = _enqueue(item)
    if pos is None:
        return jsonify({"ok": False, "error": "Queue full — please wait"}), 429

    if not item.event.wait(timeout=30):
        return jsonify({"ok": False, "error": "Timed out waiting in queue"}), 504

    code = 200 if item.result.get("ok") else 500
    return jsonify({**item.result, "username": username, "queue_pos": pos}), code


@app.route("/api/interrupt", methods=["POST"])
def send_interrupt():
    """Queue a Ctrl+C (SIGINT) for the tmux session."""
    data     = request.get_json(silent=True) or {}
    username = _clean_username(data.get("username", ""))

    _touch_user(username, request.remote_addr, command=True)

    item = _QueueItem("^C", username, request.remote_addr, interrupt=True)
    pos  = _enqueue(item)
    if pos is None:
        return jsonify({"ok": False, "error": "Queue full — please wait"}), 429

    if not item.event.wait(timeout=30):
        return jsonify({"ok": False, "error": "Timed out waiting in queue"}), 504

    code = 200 if item.result.get("ok") else 500
    return jsonify({**item.result, "username": username}), code


@app.route("/api/heartbeat", methods=["POST"])
def heartbeat():
    """Keep a user visible in the online list."""
    data     = request.get_json(silent=True) or {}
    username = _clean_username(data.get("username", ""))
    _touch_user(username, request.remote_addr)
    return jsonify({"ok": True})


@app.route("/api/users", methods=["GET"])
def get_users():
    """Return currently active usernames (seen within USER_TIMEOUT seconds)."""
    cutoff = time.time() - USER_TIMEOUT
    users  = [u for u, d in list(active_users.items()) if d["last_seen"] > cutoff]
    return jsonify({"users": users, "count": len(users)})


@app.route("/api/connections", methods=["GET"])
def get_connections():
    """Return detailed connection info: username, IP, activity times, command count."""
    now    = time.time()
    cutoff = now - USER_TIMEOUT
    rows   = []
    for username, d in sorted(active_users.items(), key=lambda x: -x[1]["last_seen"]):
        if d["last_seen"] < cutoff:
            continue
        rows.append({
            "username":    username,
            "ip":          d["ip"],
            "first_seen":  time.strftime("%H:%M:%S", time.localtime(d["first_seen"])),
            "last_seen":   time.strftime("%H:%M:%S", time.localtime(d["last_seen"])),
            "idle_s":      round(now - d["last_seen"]),
            "cmd_count":   d["cmd_count"],
        })
    return jsonify({"connections": rows, "count": len(rows)})


@app.route("/api/history", methods=["GET"])
def get_history():
    """Return recent command history."""
    return jsonify({"history": list(command_history)})


@app.route("/api/whitelist", methods=["GET"])
def get_whitelist():
    """Return the list of allowed commands."""
    return jsonify({"commands": sorted(ALLOWED_COMMANDS)})


@app.route("/api/health", methods=["GET"])
def health():
    """Health check."""
    with _queue_lock:
        queue_depth = len(_queue)
    online = sum(1 for d in active_users.values() if time.time() - d["last_seen"] < USER_TIMEOUT)
    return jsonify({"status": "ok", "tmux_session": TMUX_SESSION,
                    "queue_depth": queue_depth, "users_online": online})


# ── Entry point ────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=False, threaded=True)
