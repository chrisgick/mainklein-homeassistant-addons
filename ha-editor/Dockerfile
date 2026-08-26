# ha-editor add-on (CF-7293). Debian/glibc base — the Claude CLI ships glibc
# binaries and is unreliable on Alpine/musl, so we don't use the HA Alpine base.
# Ingress + options are Supervisor-side, so a non-HA base is fine; we read
# /data/options.json directly (no bashio).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl python3 python3-pip tini \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && pip3 install --no-cache-dir --break-system-packages yamllint \
 && npm install -g @anthropic-ai/claude-code \
 && apt-get clean && rm -rf /var/lib/apt/lists/* /root/.npm

WORKDIR /app
COPY src ./src
COPY panel ./panel
COPY run.sh /run.sh
RUN chmod +x /run.sh

ENV HA_CLAUDE_BIN=/usr/local/bin/claude \
    HA_WORK_ROOT=/data/work \
    INGRESS_PORT=8099

# tini reaps the git/claude child processes and forwards signals.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/run.sh"]
