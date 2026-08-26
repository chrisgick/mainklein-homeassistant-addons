// Orchestrates one edit run: clone → agent → local gate → commit → (push → PR).
// Emits structured step events so the HTTP service / add-on can stream progress.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import * as git from "./git.mjs";
import { runAgent } from "./agent.mjs";
import { runGate } from "./checks.mjs";
import { openPr, waitForChecks } from "./github.mjs";

function slug(s) {
  return (s || "edit")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "edit";
}

/**
 * @param {string} prompt
 * @param {object} cfg  from loadConfig()
 * @param {object} opts { emit?, waitForCi?, keepWorkdir? }
 */
export async function runEdit(prompt, cfg, opts = {}) {
  const emit = opts.emit ?? (() => {});
  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const dir = path.join(cfg.workRoot, runId);
  const branch = `ai/${slug(prompt)}-${runId}`;
  const result = { runId, branch, status: "started", steps: [] };
  const step = (name, data = {}) => {
    const s = { name, ...data };
    result.steps.push(s);
    emit({ type: "step", ...s });
    return s;
  };

  try {
    await mkdir(cfg.workRoot, { recursive: true });
    step("clone", { repo: cfg.repoLocal || cfg.repoUrl, base: cfg.base });
    await git.clone({ repoUrl: cfg.repoUrl, repoLocal: cfg.repoLocal, base: cfg.base, dir, githubToken: cfg.githubToken });

    step("branch", { branch });
    await git.createBranch(dir, branch);

    step("agent", { mode: cfg.agentMode });
    const agent = await runAgent(dir, prompt, cfg, emit);
    result.summary = agent.summary;
    if (agent.usage) result.usage = agent.usage;

    const files = await git.changedFiles(dir);
    step("changes", { files });
    if (files.length === 0) {
      result.status = "no_changes";
      return result;
    }

    step("gate", {});
    const gate = await runGate(dir, files);
    result.gate = gate;
    if (!gate.ok) {
      result.status = "gate_failed";
      step("gate_failed", { checks: gate.checks });
      return result;
    }

    result.diffStat = await git.diffStat(dir); // working tree vs HEAD, before commit
    const commitMsg = `AI: ${prompt}\n\n${agent.summary}\n\nAuthored by ha-editor (CF-7293). Review before merge.`;
    const sha = await git.commitAll(dir, commitMsg);
    result.sha = sha;
    step("commit", { sha, diffStat: result.diffStat });

    if (cfg.dryRun) {
      result.status = "dry_run";
      step("dry_run", { note: "stopped before push/PR (--dry-run)" });
      return result;
    }

    if (!cfg.githubToken) throw new Error("GITHUB_TOKEN required to push/open PR (or use --dry-run)");
    await git.rebaseOntoBase(dir, cfg.base, cfg.githubToken);
    await git.push(dir, branch, cfg.githubToken);
    step("push", { branch });

    const pr = await openPr({
      dir,
      base: cfg.base,
      head: branch,
      title: `AI: ${prompt}`.slice(0, 72),
      body: `${agent.summary}\n\n---\nAuthored by **ha-editor** (CF-7293). CI (yamllint + HA check-config) must pass before merge.`,
      githubToken: cfg.githubToken,
    });
    result.prUrl = pr.url;
    step("pr", { url: pr.url });

    if (opts.waitForCi) {
      const ci = await waitForChecks({ dir, prUrl: pr.url, githubToken: cfg.githubToken });
      result.ci = ci;
      step("ci", ci);
      result.status = ci.state === "success" ? "pr_ci_green" : `pr_ci_${ci.state}`;
    } else {
      result.status = "pr_open";
    }
    return result;
  } catch (err) {
    result.status = "error";
    result.error = String(err && err.message ? err.message : err);
    step("error", { error: result.error });
    return result;
  } finally {
    if (!opts.keepWorkdir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Read-only Q&A: clone → answer a question about the config → return the answer.
 * No branch, no gate, no commit, no push, no PR. (CF-7293 Ask mode.)
 */
export async function runAsk(question, cfg, opts = {}) {
  const emit = opts.emit ?? (() => {});
  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const dir = path.join(cfg.workRoot, runId);
  const result = { runId, mode: "ask", status: "started", steps: [] };
  const step = (name, data = {}) => {
    const s = { name, ...data };
    result.steps.push(s);
    emit({ type: "step", ...s });
    return s;
  };
  try {
    await mkdir(cfg.workRoot, { recursive: true });
    step("clone", { repo: cfg.repoLocal || cfg.repoUrl, base: cfg.base });
    await git.clone({ repoUrl: cfg.repoUrl, repoLocal: cfg.repoLocal, base: cfg.base, dir, githubToken: cfg.githubToken });
    step("ask", { mode: cfg.agentMode });
    const agent = await runAgent(dir, question, cfg, emit, "ask");
    result.answer = agent.summary;
    if (agent.usage) result.usage = agent.usage;
    result.status = "answered";
    return result;
  } catch (err) {
    result.status = "error";
    result.error = String(err && err.message ? err.message : err);
    step("error", { error: result.error });
    return result;
  } finally {
    if (!opts.keepWorkdir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
