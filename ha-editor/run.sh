#!/usr/bin/env bash
# Map add-on options -> the env vars the bundled ha-editor pipeline expects, then
# start the panel server. Non-HA base, so we read /data/options.json directly
# (no bashio). (CF-7293)
set -euo pipefail

OPTS=/data/options.json
opt() { node -e "try{const o=require(process.argv[1]);process.stdout.write(String(o[process.argv[2]]??''))}catch(e){}" "$OPTS" "$1"; }

export HA_REPO_URL="$(opt repo_url)"
export HA_REPO_BASE="$(opt base_branch)"
export GITHUB_TOKEN="$(opt github_token)"
export HA_AGENT_MODE="$(opt agent_mode)"
export ANTHROPIC_BASE_URL="$(opt litellm_base_url)"
export ANTHROPIC_AUTH_TOKEN="$(opt litellm_key)"
export HA_EDITOR_MODEL="$(opt model)"
export HA_WORK_ROOT="${HA_WORK_ROOT:-/data/work}"
export INGRESS_PORT="${INGRESS_PORT:-8099}"
# SUPERVISOR_TOKEN is injected by the Supervisor (homeassistant_api: true).

mkdir -p "${HA_WORK_ROOT}"
echo "[ha-editor] starting (agent_mode=${HA_AGENT_MODE}, repo=${HA_REPO_URL})"

exec node /app/src/panel-server.mjs
