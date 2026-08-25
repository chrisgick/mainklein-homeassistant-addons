// PR creation + CI status via the `gh` CLI (no octokit dependency for the pilot).
import { run } from "./exec.mjs";

/** Open a PR for `head` → `base`. Returns { url } or throws. */
export async function openPr({ dir, base, head, title, body, githubToken }) {
  const env = githubToken ? { GH_TOKEN: githubToken } : {};
  const args = ["pr", "create", "--base", base, "--title", title, "--body", body];
  if (head) args.push("--head", head);
  const r = await run("gh", args, { cwd: dir, env });
  if (r.code !== 0) throw new Error(`gh pr create failed: ${r.stderr || r.stdout}`);
  return { url: r.stdout.trim().split("\n").pop() };
}

/** Poll PR checks until they conclude or timeout. Returns { state, checks }. */
export async function waitForChecks({ dir, prUrl, githubToken, timeoutMs = 600000, intervalMs = 15000 }) {
  const env = githubToken ? { GH_TOKEN: githubToken } : {};
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await run("gh", ["pr", "checks", prUrl, "--json", "name,state,conclusion"], { cwd: dir, env });
    if (r.code === 0) {
      let checks = [];
      try {
        checks = JSON.parse(r.stdout);
      } catch {
        /* gh may print non-json on transient errors */
      }
      const pending = checks.some((c) => ["PENDING", "IN_PROGRESS", "QUEUED", ""].includes(c.state ?? ""));
      if (checks.length && !pending) {
        const allGreen = checks.every((c) => (c.conclusion ?? c.state) === "SUCCESS" || c.state === "SUCCESS");
        return { state: allGreen ? "success" : "failure", checks };
      }
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return { state: "timeout", checks: [] };
}
