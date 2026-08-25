#!/usr/bin/with-contenv bashio
# Map add-on options -> the env vars the bundled ha-editor pipeline expects,
# then start the panel server. (CF-7293)
set -e

export HA_REPO_URL="$(bashio::config 'repo_url')"
export HA_REPO_BASE="$(bashio::config 'base_branch')"
export GITHUB_TOKEN="$(bashio::config 'github_token')"
export HA_AGENT_MODE="$(bashio::config 'agent_mode')"
export ANTHROPIC_BASE_URL="$(bashio::config 'litellm_base_url')"
export ANTHROPIC_AUTH_TOKEN="$(bashio::config 'litellm_key')"
export HA_EDITOR_MODEL="$(bashio::config 'model')"
export HA_WORK_ROOT="${HA_WORK_ROOT:-/data/work}"
export INGRESS_PORT="${INGRESS_PORT:-8099}"
# SUPERVISOR_TOKEN is injected by the Supervisor (homeassistant_api: true).

mkdir -p "${HA_WORK_ROOT}"
bashio::log.info "ha-editor starting (agent_mode=${HA_AGENT_MODE}, repo=${HA_REPO_URL})"

exec node /app/src/panel-server.mjs
