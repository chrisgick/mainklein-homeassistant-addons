// ha-editor config resolution (CF-7293). Pure env → object, no side effects.
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function whichClaude() {
  // Prefer the real installed binary over the framework `claude()` shell wrapper
  // (which prints VPN/mcp-warm noise and shadows the binary in interactive bash).
  const home = process.env.HOME || "";
  const known = home ? path.join(home, ".local/bin/claude") : "";
  if (known && existsSync(known)) return known;
  try {
    const p = execSync("command -v claude", { encoding: "utf8" }).trim();
    return p || null;
  } catch {
    return null;
  }
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  const authToken = overrides.authToken ?? env.ANTHROPIC_AUTH_TOKEN ?? "";
  // Auto-fall back to the stub agent when no real-Claude key is wired yet
  // (Phase 0 deploy is held — see CF-7293). Explicit HA_AGENT_MODE wins.
  const requestedMode = overrides.agentMode ?? env.HA_AGENT_MODE ?? "stub";
  const agentMode = requestedMode === "claude" && !authToken ? "stub" : requestedMode;

  return {
    repoUrl: overrides.repoUrl ?? env.HA_REPO_URL ?? "https://github.com/matthias537/mainklein-homeassistant-.git",
    repoLocal: overrides.repoLocal ?? env.HA_REPO_LOCAL ?? "",
    base: overrides.base ?? env.HA_REPO_BASE ?? "main",
    githubToken: overrides.githubToken ?? env.GITHUB_TOKEN ?? "",
    workRoot: path.resolve(overrides.workRoot ?? env.HA_WORK_ROOT ?? "./work"),
    dryRun: overrides.dryRun ?? false,
    agentMode,
    llm: {
      // Point at the LiteLLM root — the Anthropic client appends /v1/messages
      // (the unified endpoint that accepts the virtual key). NOT /llm/anthropic
      // (the passthrough), which 401s on virtual keys (CF-7293).
      baseUrl: overrides.baseUrl ?? env.ANTHROPIC_BASE_URL ?? "https://api.agiliton.cloud/llm",
      authToken,
      model: overrides.model ?? env.HA_EDITOR_MODEL ?? "mainklein-editor",
    },
    claudeBin: overrides.claudeBin ?? env.HA_CLAUDE_BIN ?? whichClaude(),
    // Guardrails passed to the agent. Edits confined to the config tree; the
    // SOPS-encrypted secrets file and HA-owned .storage are never touched.
    allowedTools: [
      "Read",
      "Edit",
      "Bash(git status)",
      "Bash(git diff:*)",
      "Bash(yamllint:*)",
    ],
    disallowedTools: [
      "Edit(**/secrets.yaml)",
      "Edit(**/.storage/**)",
      "Bash(git push:*)",
      "Bash(rm:*)",
    ],
  };
}
