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

// Tolerant YAML parse: HA config uses custom tags (!include, !secret,
// !include_dir_named, …) that a plain SafeLoader rejects. Register a catch-all
// multi-constructor so we validate YAML *syntax* without resolving the tags
// (the authoritative HA check-config runs in CI).
const YAML_PARSE_PY = `
import sys, yaml
class L(yaml.SafeLoader): pass
L.add_multi_constructor('', lambda loader, suffix, node: None)
with open(sys.argv[1]) as f:
    yaml.load(f, Loader=L)
`;

/** Validate every changed *.yaml parses (HA-tag-tolerant; python3 yaml, no JS dep). */
export async function yamlParses(dir, files) {
  const yamls = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const results = [];
  for (const f of yamls) {
    const r = await run("python3", ["-c", YAML_PARSE_PY, f], { cwd: dir });
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
