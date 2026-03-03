#!/bin/bash
set -e

# ── tmux configuration (written as root, tmux picks it up) ───────────────────
cat > /root/.tmux.conf << 'EOF'
set -g default-terminal "xterm-256color"
set -g history-limit 5000
set -g status-style "bg=#1a1b28,fg=#38d9e8"
set -g status-left "#[fg=#f0c030,bold] SANDBOX "
set -g status-right "#[fg=#55566a]%H:%M:%S "
set -g pane-border-style "fg=#1a1b28"
set -g pane-active-border-style "fg=#f0c030"
EOF

# Share the config with learner
cp /root/.tmux.conf /sandbox/.tmux.conf
chown learner:root /sandbox/.tmux.conf

# ── Start tmux session as the learner user ────────────────────────────────────
# "su -l learner" gives a proper login shell that reads learner's .bashrc,
# which enforces the cd restriction and sets the restricted prompt.
tmux new-session -d -s main -x 200 -y 50 "su -l learner"

sleep 0.4

# ── Welcome banner (sent as keystrokes into the learner shell) ────────────────
tmux send-keys -t main 'clear' Enter
sleep 0.2
tmux send-keys -t main 'echo ""' Enter
tmux send-keys -t main 'echo "  ╔══════════════════════════════════════════════════╗"' Enter
tmux send-keys -t main 'echo "  ║   🐧  Interactive Linux Learning Terminal       ║"' Enter
tmux send-keys -t main 'echo "  ║   Viewers send commands via the livestream!      ║"' Enter
tmux send-keys -t main 'echo "  ╚══════════════════════════════════════════════════╝"' Enter
tmux send-keys -t main 'echo ""' Enter
tmux send-keys -t main 'echo "  Try: ls    cat documents/fruits.txt    pwd"' Enter
tmux send-keys -t main 'echo ""' Enter

# ── Start Flask API (foreground — keeps container alive) ──────────────────────
echo "[entrypoint] tmux session 'main' started as learner"
echo "[entrypoint] Starting API server on :3000 …"
exec python3 /app/server.py

