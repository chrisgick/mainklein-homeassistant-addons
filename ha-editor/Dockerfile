ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base:latest
FROM ${BUILD_FROM}

# Node 20 (Alpine base) + the pipeline's runtime deps: git, yamllint, gh, and the
# Claude Code CLI. bashio ships in the HA base image.
RUN apk add --no-cache nodejs npm git github-cli py3-pip \
    && (pip3 install --no-cache-dir --break-system-packages yamllint || pip3 install --no-cache-dir yamllint) \
    && npm install -g @anthropic-ai/claude-code \
    && rm -rf /var/cache/apk/* /root/.npm

WORKDIR /app
COPY src ./src
COPY panel ./panel
COPY run.sh /run.sh
RUN chmod +x /run.sh

# The pipeline resolves the claude binary via HA_CLAUDE_BIN, else `command -v claude`.
ENV HA_CLAUDE_BIN=/usr/local/bin/claude \
    HA_WORK_ROOT=/data/work \
    INGRESS_PORT=8099

CMD ["/run.sh"]
