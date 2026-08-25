// Fast local pre-PR gate. Mirrors the repo's yamllint CI job exactly; the
// authoritative HA `check-config` (frenck/action-home-assistant) runs in CI —
// see CF-7293 (we don't ship a full HA runtime in this service for the pilot).
import { existsSync } from "node:fs";
import path from "node:path";
import { run } from "./exec.mjs";

/** Run `yamllint -c .yamllint .` the same way validate.yml does. */
export async function yamllint(dir) {
  const hasConfig = existsSync(path.join(dir, ".yamllint"));
  const args = hasConfig ? ["-c", ".yamllint", "."] : ["."];
  const r = await run("yamllint", args, { cwd: dir });
  return {
    name: "yamllint",
    ok: r.code === 0,
    skipped: r.code === -1, // yamllint not installed
    output: (r.stdout || r.stderr).trim(),
  };
}

/** Validate every changed *.yaml parses (python3 yaml — no JS dep). */
export async function yamlParses(dir, files) {
  const yamls = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const results = [];
  for (const f of yamls) {
    const r = await run(
      "python3",
      ["-c", "import sys,yaml; yaml.safe_load(open(sys.argv[1]))", f],
      { cwd: dir }
    );
    results.push({ file: f, ok: r.code === 0, error: r.code === 0 ? "" : r.stderr.trim() });
  }
  return { name: "yaml-parse", ok: results.every((x) => x.ok), files: results };
}

/** Run the full local gate; returns { ok, checks[] }. */
export async function runGate(dir, files) {
  const checks = [];
  checks.push(await yamllint(dir));
  checks.push(await yamlParses(dir, files));
  const blocking = checks.filter((c) => !c.skipped);
  return { ok: blocking.every((c) => c.ok), checks };
}
