#!/bin/bash
set -e

# ── Create a practice directory structure ─────────────────────────────────────
# (Already baked into the image, but ensure it exists at runtime)
mkdir -p /sandbox/projects /sandbox/documents /sandbox/scripts

# ── tmux configuration ────────────────────────────────────────────────────────
cat > ~/.tmux.conf << 'EOF'
set -g default-terminal "xterm-256color"
set -g history-limit 5000
set -g status-style "bg=#1a1b28,fg=#38d9e8"
set -g status-left "#[fg=#f0c030,bold] SANDBOX "
set -g status-right "#[fg=#55566a]%H:%M:%S "
set -g pane-border-style "fg=#1a1b28"
set -g pane-active-border-style "fg=#f0c030"
EOF

# ── Start tmux session ────────────────────────────────────────────────────────
tmux new-session -d -s main -x 200 -y 50

# Give tmux a moment to initialise
sleep 0.3

# ── Welcome message ───────────────────────────────────────────────────────────
tmux send-keys -t main "cd /sandbox && clear" Enter
sleep 0.3

tmux send-keys -t main 'echo ""' Enter
tmux send-keys -t main 'echo "  ╔══════════════════════════════════════════════════╗"' Enter
tmux send-keys -t main 'echo "  ║   🐧  Interactive Linux Learning Terminal       ║"' Enter
tmux send-keys -t main 'echo "  ║   Viewers send commands via the livestream!      ║"' Enter
tmux send-keys -t main 'echo "  ╚══════════════════════════════════════════════════╝"' Enter
tmux send-keys -t main 'echo ""' Enter
tmux send-keys -t main 'echo "  📂 Try: ls -la | cat documents/welcome.txt"' Enter
tmux send-keys -t main 'echo ""' Enter

# ── Start Flask API (foreground — keeps container alive) ──────────────────────
echo "[entrypoint] tmux session 'main' started"
echo "[entrypoint] Starting API server on :3000 …"
exec python3 /app/server.py
