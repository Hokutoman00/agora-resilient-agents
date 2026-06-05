import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { TaskLedger } from './ledger.js';
import { injectFailureAndRecover } from './watchdog.js';
import type { FailureKind } from './types.js';

const app = new Hono();
const ledger = new TaskLedger();

app.use('*', cors());

app.get('/api/state', c => c.json(ledger.snapshot()));

app.post('/api/chaos/:kind', c => {
  const kind = c.req.param('kind') as FailureKind;
  const receipt = injectFailureAndRecover(ledger, { failureKind: kind || 'lost_agent' });
  return c.json({ ok: true, receipt, state: ledger.snapshot() });
});

app.post('/api/reset', c => c.json({ ok: true, state: ledger.reset() }));

app.get('/', c => c.html(renderDashboard(ledger.snapshot())));

function renderDashboard(state: ReturnType<TaskLedger['snapshot']>): string {
  const startedAt = state.events[0]?.at ?? new Date().toISOString();
  const agentCards = state.agents.map(a => `<article class="agent ${a.status}" data-agent-id="${a.id}">
    <div>
      <strong>${escapeHtml(a.label)}</strong>
      <span>${escapeHtml(a.role)}</span>
    </div>
    <em><i></i>${escapeHtml(a.status)}</em>
  </article>`).join('');
  const events = [...state.events].reverse().slice(0, 12).map(e => `<li class="${e.severity}">
    <time>${relativeTime(startedAt, e.at)}</time><b>${severityCode(e.severity)}</b><span>${escapeHtml(e.message)}</span>
  </li>`).join('');
  const receipts = state.receipts.map(renderReceipt).join('') || '<p class="empty">No handoff yet. Inject chaos to prove recovery.</p>';
  const tasks = state.tasks.map(t => `<article class="task">
    <h3>${escapeHtml(t.title)}</h3>
    <div class="task-meta">
      <span>Status</span><b>${escapeHtml(t.status)}</b>
      <span>Assigned</span><b>${escapeHtml(t.assignedAgentId)}</b>
      <span>Completed</span><b>${escapeHtml(t.completedParts.join(', ') || 'none')}</b>
      <span>Failed</span><b>${escapeHtml(t.failedParts.join(', ') || 'none')}</b>
    </div>
  </article>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AGORA</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    :root {
      color-scheme: dark;
      --bg:#0a0b0d; --surface:#111318; --border:#1e2128; --text:#e8eaf0; --muted:#5a6070; --accent:#e8a020;
      --healthy:#2a7a52; --busy:#c47a1a; --failed:#b03030; --degraded:#8a5a20;
      --sev-info:#2a4a7a; --sev-warn:#c47a1a; --sev-error:#b03030; --sev-success:#2a7a52;
      font-family:'JetBrains Mono','Cascadia Mono','Fira Code',monospace;
      background:var(--bg); color:var(--text);
    }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font-size:13px; }
    header { height:58px; display:flex; align-items:center; justify-content:space-between; padding:0 32px; border-bottom:1px solid var(--border); }
    h1 { margin:0; font-size:28px; line-height:1; letter-spacing:.15em; font-weight:700; }
    .live { display:flex; align-items:center; gap:7px; color:var(--accent); font-size:12px; letter-spacing:.12em; }
    .live i { width:7px; height:7px; border-radius:50%; background:var(--accent); display:block; }
    main { display:grid; grid-template-columns:minmax(360px,.95fr) minmax(420px,1.05fr); gap:1px; min-height:calc(100vh - 58px); background:var(--border); }
    section { min-width:0; background:var(--bg); padding:24px 32px; }
    .stack { display:grid; gap:22px; align-content:start; }
    .section-title { margin:0 0 10px; color:var(--muted); font-size:11px; letter-spacing:.12em; text-transform:uppercase; font-weight:700; }
    .agents { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .agent, .task, .receipt, .timeline { background:var(--surface); border:1px solid var(--border); border-radius:2px; }
    .agent { min-height:94px; display:grid; align-content:space-between; gap:14px; padding:12px 14px; border-left-width:4px; }
    .agent.healthy { border-left-color:var(--healthy); } .agent.busy { border-left-color:var(--busy); }
    .agent.failed { border-left-color:var(--failed); } .agent.degraded { border-left-color:var(--degraded); }
    .agent strong { display:block; font-size:13px; font-weight:700; }
    .agent span { display:block; margin-top:3px; color:var(--muted); font-size:11px; }
    .agent em { display:flex; align-items:center; color:var(--status-color,var(--muted)); font-style:normal; font-size:11px; text-transform:uppercase; }
    .agent em i { width:6px; height:6px; border-radius:50%; display:inline-block; margin-right:6px; background:currentColor; }
    .agent.healthy em { color:var(--healthy); } .agent.busy em { color:var(--busy); }
    .agent.failed em { color:var(--failed); } .agent.degraded em { color:var(--degraded); }
    .controls { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    button { font-family:inherit; font-size:12px; border-radius:2px; cursor:pointer; background:transparent; }
    .chaos-btn { border:1px solid #5a2020; color:#e07070; padding:7px 12px; }
    .chaos-btn:hover { border-color:var(--failed); color:#f0a0a0; }
    .reset-btn { margin-left:auto; border:1px solid var(--border); color:var(--muted); padding:7px 14px; }
    .task { padding:14px; }
    .task h3 { margin:0 0 12px; font-size:15px; font-weight:700; }
    .task-meta, .receipt-row { display:grid; grid-template-columns:140px 1fr; gap:8px; }
    .task-meta span, .receipt-key { color:var(--muted); font-size:12px; }
    .task-meta b, .receipt-val { color:var(--text); font-size:13px; font-weight:400; min-width:0; overflow-wrap:anywhere; }
    .receipt { padding:14px; }
    .receipt-row { padding:5px 0; border-bottom:1px solid var(--border); }
    .receipt-row:last-child { border-bottom:0; }
    details { margin-top:10px; color:var(--muted); }
    summary { cursor:pointer; font-size:12px; }
    pre { margin:8px 0 0; max-height:190px; overflow:auto; border:1px solid var(--border); border-radius:2px; padding:10px; background:var(--bg); color:var(--muted); font-size:11px; }
    .timeline { list-style:none; margin:0; padding:10px 14px; display:grid; gap:0; }
    .timeline li { display:grid; grid-template-columns:54px 20px 1fr; gap:8px; align-items:start; padding:6px 0; border-bottom:1px solid var(--border); }
    .timeline li:last-child { border-bottom:0; }
    time { color:var(--muted); font-size:12px; }
    li b { font-size:12px; font-weight:700; }
    li.info b { color:var(--sev-info); } li.warn b { color:var(--sev-warn); }
    li.error b { color:var(--sev-error); } li.success b { color:var(--sev-success); }
    li span { color:var(--text); line-height:1.45; }
    .empty { margin:0; color:var(--muted); }
    .statusbar { position:fixed; right:18px; bottom:12px; color:var(--muted); font-size:11px; background:var(--bg); border:1px solid var(--border); border-radius:2px; padding:5px 8px; }
    @media (max-width: 900px) {
      main { grid-template-columns:1fr; }
      section { padding:20px; }
      .agents { grid-template-columns:repeat(2,minmax(0,1fr)); }
    }
  </style>
</head>
<body>
  <header>
    <h1>AGORA</h1>
    <div class="live"><i></i>LIVE</div>
  </header>
  <main>
    <section class="stack">
      <div>
        <h2 class="section-title">Agent Mesh</h2>
        <div class="agents" id="agents">${agentCards}</div>
      </div>
      <div class="agents" id="agents">${agentCards}</div>
      <div class="chaos-section">
        <h2 class="section-title">Chaos Injection</h2>
        <div class="controls">
          <button class="chaos-btn" onclick="injectChaos('lost_agent')">⚡ Lost Agent</button>
          <button class="chaos-btn" onclick="injectChaos('timeout')">⏱ Timeout</button>
          <button class="chaos-btn" onclick="injectChaos('bad_output')">✕ Bad Output</button>
          <button class="chaos-btn" onclick="injectChaos('stale_context')">≋ Context Loss</button>
          <button class="reset-btn" onclick="resetDemo()">↺ Reset</button>
        </div>
      </div>
    </section>
    <section class="stack">
      <div>
        <h2 class="section-title">Active Task</h2>
        <div id="tasks">${tasks}</div>
      </div>
      <div>
        <h2 class="section-title">Handoff Receipt</h2>
        <div id="receipts">${receipts}</div>
      </div>
      <div>
        <h2 class="section-title">Timeline</h2>
        <ul class="timeline" id="events">${events}</ul>
      </div>
    </section>
  </main>
  <div class="statusbar">auto-refresh /api/state · 1.5s</div>
  <script>
    const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const severityCode = value => ({ info: 'I', warn: 'W', error: 'E', success: '✓' }[value] || 'I');
    const relativeTime = (start, at) => {
      const delta = Math.max(0, Date.parse(at) - Date.parse(start || at));
      return '+' + (delta / 1000).toFixed(1) + 's';
    };
    const receiptRows = r => [
      ['failed agent', r.failedAgentId],
      ['takeover agent', r.takeoverAgentId],
      ['failure kind', r.failureKind],
      ['recovery status', r.recoveryStatus],
      ['completed parts', (r.completedParts || []).join(', ') || 'none'],
      ['failed parts', (r.failedParts || []).join(', ') || 'none'],
      ['evidence seen', (r.evidence || []).join(' / ') || 'none'],
    ].map(([k, v]) => '<div class="receipt-row"><div class="receipt-key">' + esc(k) + '</div><div class="receipt-val">' + esc(v) + '</div></div>').join('');
    const renderReceipt = r => '<article class="receipt">' + receiptRows(r) + '<details><summary>view raw JSON</summary><pre>' + esc(JSON.stringify(r, null, 2)) + '</pre></details></article>';
    async function injectChaos(kind) {
      await fetch('/api/chaos/' + kind, { method: 'POST' });
      await refresh();
    }
    async function resetDemo() {
      await fetch('/api/reset', { method: 'POST' });
      await refresh();
    }
    async function refresh() {
      const state = await fetch('/api/state').then(r => r.json());
      const startedAt = state.events[0]?.at || new Date().toISOString();
      document.getElementById('agents').innerHTML = state.agents.map(a => '<article class="agent ' + esc(a.status) + '" data-agent-id="' + esc(a.id) + '"><div><strong>' + esc(a.label) + '</strong><span>' + esc(a.role) + '</span></div><em><i></i>' + esc(a.status) + '</em></article>').join('');
      document.getElementById('tasks').innerHTML = state.tasks.map(t => '<article class="task"><h3>' + esc(t.title) + '</h3><div class="task-meta"><span>Status</span><b>' + esc(t.status) + '</b><span>Assigned</span><b>' + esc(t.assignedAgentId) + '</b><span>Completed</span><b>' + esc((t.completedParts || []).join(', ') || 'none') + '</b><span>Failed</span><b>' + esc((t.failedParts || []).join(', ') || 'none') + '</b></div></article>').join('');
      document.getElementById('receipts').innerHTML = state.receipts.length ? state.receipts.map(renderReceipt).join('') : '<p class="empty">No handoff yet. Inject chaos to prove recovery.</p>';
      document.getElementById('events').innerHTML = [...state.events].reverse().slice(0, 12).map(e => '<li class="' + esc(e.severity) + '"><time>' + relativeTime(startedAt, e.at) + '</time><b>' + severityCode(e.severity) + '</b><span>' + esc(e.message) + '</span></li>').join('');
    }
    setInterval(refresh, 1500);
  </script>
</body>
</html>`;
}

function renderReceipt(receipt: ReturnType<TaskLedger['snapshot']>['receipts'][number]): string {
  const rows = [
    ['failed agent', receipt.failedAgentId],
    ['takeover agent', receipt.takeoverAgentId],
    ['failure kind', receipt.failureKind],
    ['recovery status', receipt.recoveryStatus],
    ['completed parts', receipt.completedParts.join(', ') || 'none'],
    ['failed parts', receipt.failedParts.join(', ') || 'none'],
    ['evidence seen', receipt.evidence.join(' / ') || 'none'],
  ].map(([key, value]) => `<div class="receipt-row"><div class="receipt-key">${escapeHtml(key)}</div><div class="receipt-val">${escapeHtml(value)}</div></div>`).join('');
  return `<article class="receipt">${rows}<details><summary>view raw JSON</summary><pre>${escapeHtml(JSON.stringify(receipt, null, 2))}</pre></details></article>`;
}

function severityCode(severity: string): string {
  return ({ info: 'I', warn: 'W', error: 'E', success: '✓' } as Record<string, string>)[severity] ?? 'I';
}

function relativeTime(start: string, at: string): string {
  const delta = Math.max(0, Date.parse(at) - Date.parse(start || at));
  return `+${(delta / 1000).toFixed(1)}s`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

export default { port: Number(process.env.PORT || 8787), fetch: app.fetch };
