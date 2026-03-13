#!/bin/bash
# /opt/tutorial/tutorial.sh — Linux Learning Tutorial System
# Source this file from .bashrc.  Defines the `tutorial` command and a
# PROMPT_COMMAND hook that checks level-completion after every command.

_TUT_ACTIVE="/tmp/tutorial_active"
_TUT_LEVEL="/tmp/tutorial_level"
_TUT_TOTAL=10

# ── UI helpers ────────────────────────────────────────────────────────────────

_tut_hr()  { printf '\e[0;33m%s\e[0m\n' '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'; }
_tut_ok()  { printf '\n\e[1;32m  ✓  LEVEL CLEARED! %s\e[0m\n' "$1"; }

_tut_show() {
    local lvl=$1
    echo ""
    _tut_hr
    case $lvl in
        1)
            printf '\e[1;33m  LEVEL 1 / %d — Where am I?\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  Print your current working directory.\n'
            printf '  \e[2mHint:  pwd  (Print Working Directory)\e[0m\n'
            ;;
        2)
            printf '\e[1;33m  LEVEL 2 / %d — What'\''s here?\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  List the files in the current directory.\n'
            printf '  \e[2mHint:  ls\e[0m\n'
            ;;
        3)
            printf '\e[1;33m  LEVEL 3 / %d — Read a file\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  Display the contents of documents/readme.txt\n'
            printf '  \e[2mHint:  cat FILENAME\e[0m\n'
            ;;
        4)
            printf '\e[1;33m  LEVEL 4 / %d — Navigate\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  Change into the documents/ directory.\n'
            printf '  \e[2mHint:  cd DIRNAME\e[0m\n'
            ;;
        5)
            printf '\e[1;33m  LEVEL 5 / %d — Come back\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  Return to your home directory (/sandbox).\n'
            printf '  \e[2mHint:  cd  (with no argument goes home)\e[0m\n'
            ;;
        6)
            printf '\e[1;33m  LEVEL 6 / %d — Search in a file\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  Find lines containing "berry" in documents/fruits.txt\n'
            printf '  \e[2mHint:  grep PATTERN FILE\e[0m\n'
            ;;
        7)
            printf '\e[1;33m  LEVEL 7 / %d — Count lines\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  Count how many fruits are listed in documents/fruits.txt\n'
            printf '  \e[2mHint:  wc -l FILE\e[0m\n'
            ;;
        8)
            # Ensure missions/ doesn'\''t exist so the filesystem check is unambiguous
            rm -rf /sandbox/missions 2>/dev/null || true
            printf '\e[1;33m  LEVEL 8 / %d — Create a directory\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  Create a new directory called "missions" inside /sandbox.\n'
            printf '  \e[2mHint:  mkdir DIRNAME\e[0m\n'
            ;;
        9)
            printf '\e[1;33m  LEVEL 9 / %d — Copy a file\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  Copy documents/readme.txt into the missions/ directory.\n'
            printf '  \e[2mHint:  cp SOURCE DESTINATION\e[0m\n'
            ;;
        10)
            printf '\e[1;33m  LEVEL 10 / %d — Combine commands\e[0m\n' "$_TUT_TOTAL"
            _tut_hr
            printf '  \e[1mGoal:\e[0m  List files in /sandbox and pipe the output through sort.\n'
            printf '  \e[2mHint:  command1 | command2\e[0m\n'
            ;;
        *)
            _tut_hr
            printf '\e[1;32m  ★  ALL LEVELS COMPLETE — You are a terminal master!\e[0m\n'
            _tut_hr
            printf '  Run \e[1mtutorial reset\e[0m to play again.\n'
            ;;
    esac
    echo ""
}

# ── Advance to the next level ─────────────────────────────────────────────────

_tut_advance() {
    local msg="$1"
    local lvl
    lvl=$(cat "$_TUT_LEVEL" 2>/dev/null || echo 1)
    _tut_ok "$msg"
    local next=$(( lvl + 1 ))
    printf '%s\n' "$next" >| "$_TUT_LEVEL"
    _tut_show "$next"
}

# ── Per-level success checks ──────────────────────────────────────────────────
# Each function receives $1 = the last command the user ran.
# Use pwd checks for navigation levels; command/filesystem checks elsewhere.

_tut_check_1()  {
    [[ "$1" =~ ^[[:space:]]*pwd([[:space:]]|$) ]] && _tut_advance "Working directory printed!"
}
_tut_check_2()  {
    [[ "$1" =~ ^[[:space:]]*(ls|ll|la)([[:space:]]|$) ]] && _tut_advance "Files listed!"
}
_tut_check_3()  {
    [[ "$1" =~ cat.*readme ]] && _tut_advance "File contents displayed!"
}
_tut_check_4()  {
    # Passes once the shell is inside documents/
    [[ "$(builtin pwd)" == */documents ]] && _tut_advance "Navigated into documents/!"
}
_tut_check_5()  {
    # Passes once the shell is back at /sandbox
    [[ "$(builtin pwd)" == /sandbox ]] && _tut_advance "Back to home base!"
}
_tut_check_6()  {
    [[ "$1" =~ grep.*(fruits|berry) ]] && _tut_advance "Pattern found!"
}
_tut_check_7()  {
    [[ "$1" =~ wc.*fruits ]] && _tut_advance "Lines counted!"
}
_tut_check_8()  {
    [[ -d /sandbox/missions ]] && _tut_advance "Directory created!"
}
_tut_check_9()  {
    [[ -f /sandbox/missions/readme.txt ]] && _tut_advance "File copied successfully!"
}
_tut_check_10() {
    [[ "$1" =~ \| ]] && _tut_advance "Pipes mastered!"
}

# ── PROMPT_COMMAND hook ───────────────────────────────────────────────────────

_tutorial_check() {
    [[ ! -f "$_TUT_ACTIVE" ]] && return
    local lvl
    lvl=$(cat "$_TUT_LEVEL" 2>/dev/null) || return
    (( lvl > _TUT_TOTAL )) && return

    local last_cmd
    last_cmd=$(HISTTIMEFORMAT= history 1 | sed 's/^[[:space:]]*[0-9]*[[:space:]]*//')
    # Ignore empty or meta commands
    [[ -z "$last_cmd" || "$last_cmd" == tutorial* ]] && return

    "_tut_check_${lvl}" "$last_cmd" 2>/dev/null || true
}

# Append to PROMPT_COMMAND without overwriting it
if [[ "$PROMPT_COMMAND" != *_tutorial_check* ]]; then
    PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND; }_tutorial_check"
fi

# ── tutorial command ──────────────────────────────────────────────────────────

tutorial() {
    case "${1:-}" in
        reset)
            rm -f "$_TUT_ACTIVE" "$_TUT_LEVEL"
            printf '\n  Tutorial reset. Run \e[1mtutorial\e[0m to start again.\n\n'
            ;;
        skip)
            if [[ ! -f "$_TUT_ACTIVE" ]]; then
                printf '\n  Tutorial is not active. Run \e[1mtutorial\e[0m to begin.\n\n'
                return
            fi
            local lvl
            lvl=$(cat "$_TUT_LEVEL" 2>/dev/null || echo 1)
            printf '%s\n' $(( lvl + 1 )) >| "$_TUT_LEVEL"
            _tut_show $(( lvl + 1 ))
            ;;
        "")
            touch "$_TUT_ACTIVE"
            if [[ ! -f "$_TUT_LEVEL" ]]; then
                printf '%s\n' "1" >| "$_TUT_LEVEL"
            fi
            _tut_show "$(cat "$_TUT_LEVEL")"
            ;;
        *)
            printf '\n  Usage: tutorial [reset|skip]\n\n'
            ;;
    esac
}
