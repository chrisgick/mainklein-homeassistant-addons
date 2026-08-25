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

async function runStub(dir, prompt, emit) {
  emit({ type: "note", text: `stub agent: appending a sample automation (prompt ignored: ${prompt.slice(0, 80)})` });
  const r = await run("python3", ["-c", STUB_APPEND_PY, "automations.yaml"], { cwd: dir });
  if (r.code !== 0) throw new Error(`stub edit failed: ${r.stderr || r.stdout}`);
  return { summary: `stub: appended automation "${r.stdout.trim()}" to automations.yaml`, mode: "stub" };
}

async function runClaude(dir, prompt, cfg, emit) {
  if (!cfg.claudeBin) throw new Error("claude CLI not found (set HA_CLAUDE_BIN)");
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
    "--permission-mode", "dontAsk",
    "--model", cfg.llm.model,
    "--allowedTools", ...cfg.allowedTools,
    "--disallowedTools", ...cfg.disallowedTools,
  ];
  const env = {
    ANTHROPIC_BASE_URL: cfg.llm.baseUrl,
    ANTHROPIC_AUTH_TOKEN: cfg.llm.authToken,
    ANTHROPIC_API_KEY: "", // force AUTH_TOKEN (bearer) path
  };
  let resultText = "";
  const r = await run(cfg.claudeBin, args, {
    cwd: dir,
    env,
    onLine: (line) => {
      const t = line.trim();
      if (!t) return;
      try {
        const ev = JSON.parse(t);
        emit({ type: "agent", event: ev });
        if (ev.type === "result" && typeof ev.result === "string") resultText = ev.result;
      } catch {
        emit({ type: "agent_raw", text: t });
      }
    },
  });
  if (r.code !== 0) throw new Error(`claude -p exited ${r.code}: ${r.stderr}`);
  return { summary: resultText || "claude run complete", mode: "claude" };
}

export async function runAgent(dir, prompt, cfg, emit = () => {}) {
  return cfg.agentMode === "claude"
    ? runClaude(dir, prompt, cfg, emit)
    : runStub(dir, prompt, emit);
}
