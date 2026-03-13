# ─────────────────────────────────────────────────────────────────────────────
# Sandbox container — Ubuntu + tmux + common Linux tools + Flask API
# Serves as the interactive terminal that OBS captures AND the HTTP backend
# that receives viewer commands.
# ─────────────────────────────────────────────────────────────────────────────
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TERM=xterm-256color

# ── System packages ───────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Terminal / shell
    tmux htop bash-completion less man-db manpages \
    # Core utilities for learning
    tree curl wget net-tools iputils-ping dnsutils \
    vim nano file zip unzip tar gzip \
    # Networking tools
    iproute2 traceroute nmap openssh-client \
    # Build basics (learners may want to see gcc, make, etc.)
    build-essential \
    # Python (for the API server)
    python3 python3-pip \
    # Misc
    figlet toilet neofetch \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ───────────────────────────────────────────────────────
COPY requirements.txt /app/requirements.txt
RUN pip3 install --no-cache-dir -r /app/requirements.txt

# ── Application code ──────────────────────────────────────────────────────────
COPY server.py     /app/server.py
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# ── learner user — non-root, home = /sandbox ─────────────────────────────────
# No password, no sudo. The interactive tmux shell runs as this user.
RUN useradd --create-home --home-dir /sandbox --shell /bin/bash --no-user-group \
        --gid 0 learner \
    && mkdir -p /sandbox/projects /sandbox/documents /sandbox/scripts

# ── Tutorial system ───────────────────────────────────────────────────────────
COPY tutorial.sh /opt/tutorial/tutorial.sh
RUN sed -i 's/\r//' /opt/tutorial/tutorial.sh && chmod +x /opt/tutorial/tutorial.sh

# ── Restricted bashrc for learner ────────────────────────────────────────────
COPY learner.bashrc /sandbox/.bashrc
# Login shells (su -l) read .bash_profile; make it simply source .bashrc
RUN echo 'source ~/.bashrc' > /sandbox/.bash_profile

# ── Sandbox practice files ────────────────────────────────────────────────────
RUN printf 'Hello, World!\n' > /sandbox/documents/welcome.txt \
    && printf 'This is a sandbox for learning Linux commands.\n' > /sandbox/documents/readme.txt \
    && printf '#!/bin/bash\necho "Hello from a script!"\n' > /sandbox/scripts/hello.sh \
    && chmod +x /sandbox/scripts/hello.sh \
    && printf '#!/bin/bash\nfor i in $(seq 1 5); do echo "Line $i"; done\n' > /sandbox/scripts/loop.sh \
    && chmod +x /sandbox/scripts/loop.sh \
    && printf 'apple\nbanana\ncherry\ndate\nelderberry\n' > /sandbox/documents/fruits.txt \
    && printf '3,Alice,Engineering\n1,Bob,Marketing\n2,Carol,Engineering\n4,Dave,Sales\n' > /sandbox/documents/employees.csv \
    && chown -R learner:root /sandbox

WORKDIR /sandbox

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
