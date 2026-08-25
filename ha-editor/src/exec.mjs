// Thin promise wrapper around child_process for git/yamllint/gh/claude.
import { spawn } from "node:child_process";

/**
 * Run a command, capturing stdout/stderr. Never throws on non-zero exit —
 * returns { code, stdout, stderr } so callers decide what a failure means.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?:string, env?:object, input?:string, onLine?:(line:string)=>void}} opts
 */
export function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let buf = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (opts.onLine) {
        buf += s;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          opts.onLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: String(err) }));
    child.on("close", (code) => {
      if (opts.onLine && buf) opts.onLine(buf);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/** Like run() but throws with context on non-zero exit. */
export async function runOrThrow(cmd, args = [], opts = {}) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${r.code}\n${r.stderr || r.stdout}`.trim()
    );
  }
  return r;
}
