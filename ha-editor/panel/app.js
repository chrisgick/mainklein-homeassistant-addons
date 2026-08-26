// HA Editor Chat panel — vanilla JS, ingress-safe (all fetches RELATIVE).
// Streams NDJSON step events from the add-on backend and renders them.
// Non-blocking: multiple messages can run in parallel (soft cap), each in its
// own card, so the composer never locks while a run is in flight (CF-7293).
const $ = (s) => document.querySelector(s);
const runs = $("#runs");
const promptEl = $("#prompt");
const sendBtn = $("#send");
const modeEl = $("#mode");

// How many agent runs may be in flight at once. The backend is lock-free and
// gives each run its own workdir/branch; this only protects the LiteLLM gateway
// from too many parallel Claude sessions. Extra messages queue (FIFO).
const MAX_CONCURRENT = 3;
let inflight = 0;
const queue = [];

// Small live "N läuft · M wartet" indicator next to the grounding hint.
const statusEl = el("span", "hint");
statusEl.id = "runstatus";
statusEl.style.marginLeft = "10px";
$("#hint").after(statusEl);
function updateStatus() {
  const waiting = queue.length;
  const parts = [];
  if (inflight) parts.push(`${inflight} läuft`);
  if (waiting) parts.push(`${waiting} in Warteschlange`);
  statusEl.textContent = parts.length ? `· ${parts.join(" · ")}` : "";
}

// Show live-context availability (best-effort).
fetch("api/ha/states")
  .then((r) => r.json())
  .then((d) => { $("#hint").textContent = d.count ? `${d.count} live entities available for grounding.` : ""; })
  .catch(() => {});

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function stepLine(ev) {
  // ev is a pipeline event: {type:"step",name,...} | {type:"note"/"agent_raw",text} | ...
  if (ev.type === "note" || ev.type === "agent_raw") return `· ${ev.text || ""}`;
  if (ev.type !== "step") return null;
  switch (ev.name) {
    case "clone": return `clone ${ev.repo || ""} @ ${ev.base || ""}`;
    case "branch": return `branch ${ev.branch || ""}`;
    case "agent": return `agent (${ev.mode || ""}) working…`;
    case "changes": return `changed: ${(ev.files || []).join(", ") || "(none)"}`;
    case "gate": return `running local checks (yamllint + yaml-parse)…`;
    case "gate_failed": return `❌ local checks FAILED`;
    case "commit": return `commit ${(ev.sha || "").slice(0, 8)} — ${ev.diffStat || ""}`;
    case "push": return `pushed ${ev.branch || ""}`;
    case "pr": return `opened PR ${ev.url || ""}`;
    case "ci": return `CI: ${ev.state || ""}`;
    case "error": return `❌ ${ev.error || "error"}`;
    default: return ev.name;
  }
}

function badge(state) {
  const map = { pr_open: ["pending", "PR open — CI running"], pr_ci_green: ["ok", "CI green"],
    dry_run: ["pending", "dry run"], no_changes: ["pending", "no changes"],
    gate_failed: ["bad", "local checks failed"], error: ["bad", "error"] };
  const [cls, label] = map[state] || (String(state).includes("green") ? ["ok", state] : ["bad", state]);
  const b = el("span", `badge ${cls}`, label);
  return b;
}

// Submit: create the card, enqueue, and immediately free the composer. Never
// disables input while a run streams — that was the old blocking behaviour.
function submit() {
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  const mode = modeEl.value;
  promptEl.value = "";

  const card = el("div", "run");
  card.appendChild(el("div", "q", prompt));
  const steps = el("ul", "steps");
  card.appendChild(steps);
  runs.prepend(card);

  const job = { card, steps, prompt, mode };
  job.qli = el("li", null, "· wartet…");
  steps.appendChild(job.qli);
  queue.push(job);
  pump();
  promptEl.focus();
}

// Drain the queue up to the concurrency cap.
function pump() {
  while (inflight < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    if (job.qli) { job.qli.remove(); job.qli = null; }
    inflight++;
    startRun(job).catch(() => {}).finally(() => { inflight--; updateStatus(); pump(); });
  }
  updateStatus();
}

async function startRun(job) {
  const { card, steps, prompt, mode } = job;
  try {
    const res = await fetch(mode === "ask" ? "api/ask" : "api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "ask" ? { question: prompt } : { prompt }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let finalResult = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === "result") { finalResult = ev.result; continue; }
        const txt = stepLine(ev);
        if (txt) { const li = el("li"); li.innerHTML = `<b>${escapeHtml(txt)}</b>`; steps.appendChild(li); }
      }
    }
    renderResult(card, finalResult);
  } catch (e) {
    const li = el("li"); li.textContent = `❌ ${e.message || e}`; steps.appendChild(li);
  }
}

function fmtUsage(u) {
  if (!u) return "";
  const parts = [];
  if (u.turns) parts.push(`${u.turns} turns`);
  if (u.durationMs) parts.push(`${Math.round(u.durationMs / 1000)}s`);
  return parts.join(" · ");
}

function renderResult(card, r) {
  if (!r) { card.appendChild(el("div", "result", "no result")); return; }
  // Ask mode: render the answer, no PR card.
  if (r.mode === "ask" || r.answer !== undefined) {
    card.appendChild(el("div", "answer", r.answer || r.error || "(no answer)"));
    const u = fmtUsage(r.usage);
    if (u) card.appendChild(el("div", "hint", u));
    return;
  }
  const box = el("div", "result");
  box.appendChild(badge(r.status));
  const u = fmtUsage(r.usage);
  if (u) box.appendChild(el("span", "hint", u));
  if (r.prUrl) {
    const a = el("a", "pr", `View PR`);
    a.href = r.prUrl; a.target = "_blank"; a.rel = "noopener";
    box.appendChild(a);
  }
  if (r.summary) box.appendChild(el("span", null, r.summary));
  if (r.error) box.appendChild(el("span", null, r.error));
  card.appendChild(box);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

sendBtn.addEventListener("click", submit);
promptEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); });
