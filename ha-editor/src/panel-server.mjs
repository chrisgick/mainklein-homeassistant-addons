// HA add-on backend for the ha-editor chat panel (CF-7293).
// Runs inside the Home Assistant add-on container, behind ingress. It:
//   - serves the static panel (relative URLs only — ingress iframe base path)
//   - GET  api/ha/states : proxies http://supervisor/core/api/states with
//                          SUPERVISOR_TOKEN, returns a trimmed entity list (grounding)
//   - POST api/chat      : runs the bundled pipeline (runEdit) and streams NDJSON
// The pipeline clones from GitHub and edits via PR — it NEVER touches the Pi's
// live /config, so HA's own writes and the AI's edits can't conflict.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";
import { runEdit, runAsk } from "./pipeline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = path.join(HERE, "..", "panel");
const PORT = Number(process.env.INGRESS_PORT || process.env.PORT || 8099);
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || "";
// Ingress proxies from a fixed internal IP; reject anything else (defence in
// depth — HA already authenticates the user before proxying). Dev bypass via env.
const INGRESS_IP = "172.30.32.2";
const ALLOW_ALL = process.env.HA_INGRESS_ALLOW_ALL === "1";

function clientIp(req) {
  const ra = req.socket.remoteAddress || "";
  return ra.replace(/^::ffff:/, "");
}
function ingressOk(req) {
  return ALLOW_ALL || clientIp(req) === INGRESS_IP;
}

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "application/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};

async function serveStatic(res, file, type) {
  try {
    const body = await readFile(path.join(PANEL_DIR, file));
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

// Compact live-entity context to ground the model (best-effort; never fatal).
async function haStates(limit = 400) {
  if (!SUPERVISOR_TOKEN) return [];
  try {
    const r = await fetch("http://supervisor/core/api/states", {
      headers: { Authorization: `Bearer ${SUPERVISOR_TOKEN}` },
    });
    if (!r.ok) return [];
    const all = await r.json();
    return all.slice(0, limit).map((s) => ({
      entity_id: s.entity_id,
      state: s.state,
      name: s.attributes?.friendly_name,
    }));
  } catch {
    return [];
  }
}

function contextPreface(states) {
  if (!states.length) return "";
  const lines = states.map((s) => `- ${s.entity_id}${s.name ? ` (${s.name})` : ""}: ${s.state}`);
  return (
    `Live Home Assistant entities currently available (use exact entity_ids):\n` +
    lines.join("\n") +
    `\n\nUser request: `
  );
}

const server = http.createServer(async (req, res) => {
  if (!ingressOk(req)) {
    res.writeHead(403).end("forbidden (ingress only)");
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (req.method === "GET" && STATIC[p]) {
    return serveStatic(res, ...STATIC[p]);
  }

  if (req.method === "GET" && p === "/api/ha/states") {
    const states = await haStates();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ count: states.length, states }));
    return;
  }

  if (req.method === "GET" && p === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "ha-editor-addon" }));
    return;
  }

  if (req.method === "POST" && p === "/api/chat") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid json"}');
        return;
      }
      if (!payload.prompt) {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"prompt required"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
      const cfg = loadConfig({ dryRun: false });
      // Ground the model with the live entity list (claude mode; ignored by stub).
      const states = cfg.agentMode === "claude" ? await haStates() : [];
      const prompt = contextPreface(states) + payload.prompt;
      const emit = (ev) => {
        try {
          res.write(JSON.stringify(ev) + "\n");
        } catch {
          /* client gone */
        }
      };
      const result = await runEdit(prompt, cfg, { emit });
      res.write(JSON.stringify({ type: "result", result }) + "\n");
      res.end();
    });
    return;
  }

  if (req.method === "POST" && p === "/api/ask") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"invalid json"}');
        return;
      }
      const question = payload.question || payload.prompt;
      if (!question) {
        res.writeHead(400, { "content-type": "application/json" }).end('{"error":"question required"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-cache" });
      const cfg = loadConfig({});
      // Ground with the live entity list (claude mode) so entity questions are accurate.
      const states = cfg.agentMode === "claude" ? await haStates() : [];
      const grounded = (states.length ? contextPreface(states) : "") + question;
      const emit = (ev) => {
        try {
          res.write(JSON.stringify(ev) + "\n");
        } catch {
          /* client gone */
        }
      };
      const result = await runAsk(grounded, cfg, { emit });
      res.write(JSON.stringify({ type: "result", result }) + "\n");
      res.end();
    });
    return;
  }

  res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}');
});

server.listen(PORT, () => {
  process.stdout.write(
    `[ha-editor] panel on :${PORT} (ingress-only=${!ALLOW_ALL}, agent=${loadConfig().agentMode})\n`
  );
});
