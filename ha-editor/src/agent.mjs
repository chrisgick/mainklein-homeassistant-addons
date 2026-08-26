// Agent adapter. Two modes:
//   stub   — deterministic, no model; appends a valid automation so the whole
//            clone→gate→branch→PR pipeline is testable before Phase 0 is deployed.
//   claude — Claude Code headless (`claude -p`) against the clone, pointed at our
//            LiteLLM gateway with the dedicated mainklein key (CF-7293).
import { run } from "./exec.mjs";

const STUB_APPEND_PY = `
import sys, yaml, time
p = sys.argv[1]
try:
    data = yaml.safe_load(open(p)) or []
except FileNotFoundError:
    data = []
if not isinstance(data, list):
    raise SystemExit("automations.yaml is not a list; refusing to stub-edit")
entry = {
    "id": "ha_editor_%d" % int(time.time()),
    "alias": "AI: turn off porch light at sunrise",
    "description": "Added by ha-editor stub (CF-7293 pilot). Replace with a real claude -p run once Phase 0 is deployed.",
    "trigger": [{"platform": "sun", "event": "sunrise"}],
    "condition": [],
    "action": [{"service": "light.turn_off", "target": {"entity_id": "light.porch"}}],
    "mode": "single",
}
data.append(entry)
with open(p, "w") as f:
    yaml.safe_dump(data, f, sort_keys=False, default_flow_style=False, allow_unicode=True)
print(entry["alias"])
`;

async function runStub(dir, prompt, emit, mode = "edit") {
  if (mode === "ask") {
    emit({ type: "note", text: "stub ask: no model — set agent_mode=claude for real answers." });
    return { summary: "Stub mode: set agent_mode to 'claude' to get real answers about your config.", mode: "ask-stub" };
  }
  emit({ type: "note", text: `stub agent: appending a sample automation (prompt ignored: ${prompt.slice(0, 80)})` });
  const r = await run("python3", ["-c", STUB_APPEND_PY, "automations.yaml"], { cwd: dir });
  if (r.code !== 0) throw new Error(`stub edit failed: ${r.stderr || r.stdout}`);
  return { summary: `stub: appended automation "${r.stdout.trim()}" to automations.yaml`, mode: "stub" };
}

// Domain system prompt: repo conventions + real-entity grounding + self-verify.
// Raises correctness and first-pass CI success (CF-7293 quality pass).
const HA_SYSTEM_PROMPT = `You are editing a Home Assistant configuration git repository. Follow these rules:
- FIRST, read ./CLAUDE.md at the repo root if it exists and treat its conventions as authoritative — it is the source of truth for this repo. The rules below are a fallback for when it is absent.
- Structure: automations go in automations.yaml (a top-level YAML list of automation mappings); scripts in scripts.yaml; scenes in scenes.yaml; reusable config under packages/ (referenced via !include_dir_named). Match the repo's existing !include structure, key style, and formatting. Keep the change minimal and scoped to the request.
- Entities: use ONLY entity_ids that actually exist — prefer any provided live-entity list, otherwise grep the repo's existing config for real ids. If the entity you need is not available, say so explicitly and pick the closest existing one instead of inventing an id.
- Self-verify BEFORE finishing: run \`yamllint -c .yamllint .\` and re-read the file(s) you changed; fix any error and re-run until clean.
- NEVER edit secrets.yaml (SOPS-encrypted) or anything under .storage/.
- Finish with a brief note of what you changed and which entities it affects.`;

// Read-only Q&A mode: answer questions about the config, never modify it.
const ASK_SYSTEM_PROMPT = `You are a read-only assistant answering questions about a Home Assistant configuration git repository. Read and grep the files to answer accurately. Do NOT edit, create, or delete anything. Cite the file(s) and entity_ids you reference; if something is not in the config, say so plainly.`;
const ASK_ALLOWED = ["Read", "Grep", "Bash(git log:*)", "Bash(git grep:*)", "Bash(grep:*)"];
const ASK_DISALLOWED = ["Edit", "Write", "Bash(git push:*)", "Bash(git commit:*)", "Bash(rm:*)"];

async function runClaude(dir, prompt, cfg, emit, mode = "edit") {
  if (!cfg.claudeBin) throw new Error("claude CLI not found (set HA_CLAUDE_BIN)");
  const isAsk = mode === "ask";
  // NOTE: flag names verified against the headless docs (CF-7293 research); if the
  // installed CLI rejects one, adjust here — claude mode is exercised only after
  // Phase 0 deploy, so this path is validated then.
  // --allowedTools / --disallowedTools are variadic (<tools...>): each tool must
  // be its own argv entry, not a single comma-joined string (verified against
  // claude 2.1.214 --help).
  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--bare",
    "--permission-mode", "bypassPermissions",
    "--model", cfg.llm.model,
    "--append-system-prompt", isAsk ? ASK_SYSTEM_PROMPT : HA_SYSTEM_PROMPT,
    "--allowedTools", ...(isAsk ? ASK_ALLOWED : cfg.allowedTools),
    "--disallowedTools", ...(isAsk ? ASK_DISALLOWED : cfg.disallowedTools),
  ];
  const env = {
    ANTHROPIC_BASE_URL: cfg.llm.baseUrl,
    ANTHROPIC_AUTH_TOKEN: cfg.llm.authToken,
    ANTHROPIC_API_KEY: "", // force AUTH_TOKEN (bearer) path
  };
  let resultText = "";
  let usage = null;
  const r = await run(cfg.claudeBin, args, {
    cwd: dir,
    env,
    onLine: (line) => {
      const t = line.trim();
      if (!t) return;
      try {
        const ev = JSON.parse(t);
        emit({ type: "agent", event: ev });
        if (ev.type === "result") {
          if (typeof ev.result === "string") resultText = ev.result;
          usage = { costUsd: ev.total_cost_usd, turns: ev.num_turns, durationMs: ev.duration_ms };
        }
      } catch {
        emit({ type: "agent_raw", text: t });
      }
    },
  });
  if (r.code !== 0) throw new Error(`claude -p exited ${r.code}: ${r.stderr}`);
  return { summary: resultText || "claude run complete", mode: "claude", usage };
}

export async function runAgent(dir, prompt, cfg, emit = () => {}, mode = "edit") {
  return cfg.agentMode === "claude"
    ? runClaude(dir, prompt, cfg, emit, mode)
    : runStub(dir, prompt, emit, mode);
}
