// Git operations for the per-run clone. All confined to a workdir.
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { run, runOrThrow } from "./exec.mjs";

// Build a GIT_ASKPASS shim so a token feeds git's credential prompts WITHOUT
// ever appearing in argv (so it can't leak into an error string). Returns
// { env, cleanup }. With no token, env is undefined (ambient credential helper,
// e.g. dev `gh auth setup-git`). GITHUB_TOKEN is needed to clone/fetch/push a
// private repo (the Pi add-on container has no ambient git credentials).
async function askpass(githubToken) {
  if (!githubToken) return { env: undefined, cleanup: async () => {} };
  const p = path.join(os.tmpdir(), `ha-editor-askpass-${Date.now()}-${Math.floor(Math.random() * 1e6)}.sh`);
  await fs.writeFile(p, `#!/bin/sh\necho "$HA_EDITOR_GH_TOKEN"\n`, { mode: 0o700 });
  return {
    env: { GIT_ASKPASS: p, HA_EDITOR_GH_TOKEN: githubToken, GIT_TERMINAL_PROMPT: "0" },
    cleanup: async () => { await fs.rm(p, { force: true }).catch(() => {}); },
  };
}

export async function clone({ repoUrl, repoLocal, base, dir, githubToken }) {
  const src = repoLocal || repoUrl;
  // Only authenticate a real remote clone; a local-path source needs no token.
  const { env, cleanup } = await askpass(repoLocal ? undefined : githubToken);
  try {
    await runOrThrow("git", ["clone", "--depth", "50", "--branch", base, src, dir], { env });
  } finally {
    await cleanup();
  }
  // Detach origin from a local source so an accidental push can't hit a dev checkout.
  if (repoLocal && repoUrl) {
    await run("git", ["remote", "set-url", "origin", repoUrl], { cwd: dir });
  }
  return dir;
}

export async function createBranch(dir, name) {
  await runOrThrow("git", ["checkout", "-b", name], { cwd: dir });
  return name;
}

export async function rebaseOntoBase(dir, base, githubToken) {
  const { env, cleanup } = await askpass(githubToken);
  try {
    await runOrThrow("git", ["fetch", "origin", base], { cwd: dir, env });
  } finally {
    await cleanup();
  }
  const r = await run("git", ["rebase", `origin/${base}`], { cwd: dir });
  if (r.code !== 0) {
    await run("git", ["rebase", "--abort"], { cwd: dir });
    throw new Error(`rebase onto origin/${base} conflicted; aborted so a human/agent can re-plan`);
  }
}

export async function changedFiles(dir) {
  const r = await runOrThrow("git", ["status", "--porcelain"], { cwd: dir });
  return r.stdout
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean);
}

export async function diffStat(dir) {
  const r = await run("git", ["diff", "--stat", "HEAD"], { cwd: dir });
  return r.stdout.trim();
}

export async function commitAll(dir, message) {
  await runOrThrow("git", ["add", "-A"], { cwd: dir });
  await runOrThrow(
    "git",
    ["-c", "user.name=ha-editor", "-c", "user.email=ha-editor@agiliton.eu", "commit", "-m", message],
    { cwd: dir }
  );
  const sha = await runOrThrow("git", ["rev-parse", "HEAD"], { cwd: dir });
  return sha.stdout.trim();
}

export async function push(dir, branch, githubToken) {
  // Auth comes from git's credential layer, never from argv — so a token can't
  // leak into an error string. When a token is supplied (prod: GitHub App token),
  // feed it via an ASKPASS shim; otherwise rely on the ambient credential helper.
  const { env, cleanup } = await askpass(githubToken);
  try {
    await runOrThrow("git", ["push", "origin", `${branch}:${branch}`], { cwd: dir, env });
  } finally {
    await cleanup();
  }
}
