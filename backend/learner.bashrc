# ── Sandbox shell for learner ─────────────────────────────────────────────────
# Overrides cd to prevent escaping /sandbox.

# ── cd restriction ────────────────────────────────────────────────────────────
cd() {
    local target="${1:-$HOME}"
    local resolved
    resolved=$(realpath -m "$target" 2>/dev/null) || resolved="$target"
    case "$resolved" in
        /sandbox|/sandbox/*)
            builtin cd "$target"
            ;;
        *)
            printf '\e[31m  ✗  Restricted to /sandbox\e[0m\n' >&2
            return 1
            ;;
    esac
}

# ── Prompt ────────────────────────────────────────────────────────────────────
PS1='\[\e[0;33m\]learner\[\e[0m\]@\[\e[0;36m\]sandbox\[\e[0m\]:\[\e[0;34m\]\w\[\e[0m\]\$ '

# ── Shell quality-of-life ─────────────────────────────────────────────────────
export HOME=/sandbox
export TERM=xterm-256color
set -o noclobber   # prevent accidental file overwrites with >  (use >| to force)

# Enable bash completion if available
[[ -f /etc/bash_completion ]] && source /etc/bash_completion

# Handy aliases
alias ll='ls -la'
alias la='ls -A'
alias ..='cd ..'

# Always land in /sandbox on new shell
builtin cd /sandbox

# ── Tutorial system ───────────────────────────────────────────────────────────
[[ -f /opt/tutorial/tutorial.sh ]] && source /opt/tutorial/tutorial.sh
