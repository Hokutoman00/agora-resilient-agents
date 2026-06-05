import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { activeLedger, runAgentTask, setPendingChaos } from './runner.js';
import type { AgoraState, FailureKind, TaskRecord } from './types.js';

const app = new Hono();
const DEFAULT_TASK =
  'The primary AI model provider for our customer support agent is unavailable. Identify 3 competitor products likely affected by the same AI outage and draft a customer communication plan.';
const TASK_PRESETS = [
  {
    label: 'Provider Outage Impact',
    task: DEFAULT_TASK,
  },
  {
    label: 'PR Risk Review',
    task: 'A critical PR must ship today. Review the change for outage risks, missing tests, and customer-impacting regressions.',
  },
  {
    label: 'Incident Response Plan',
    task: 'A rate limit incident is affecting AI responses. Draft an incident response plan and customer status update.',
  },
];

app.use('*', cors());

app.get('/api/state', c => c.json(activeLedger.snapshot()));

app.post('/api/chaos/:kind', c => {
  const kind = c.req.param('kind') as FailureKind;
  setPendingChaos(kind || 'lost_agent');
  activeLedger.event('warn', `Chaos armed: ${kind}`, 'watchdog', undefined, 'watchdog');
  return c.json({ ok: true, armed: kind, state: activeLedger.snapshot() });
});

app.post('/api/run', async c => {
  let body: { task?: string } = {};
  try {
    body = await c.req.json<{ task?: string }>();
  } catch {
    body = {};
  }
  const topic = body.task?.trim() || DEFAULT_TASK;
  const result = await runAgentTask(topic);
  return c.json(result);
});

app.post('/api/reset', c => c.json({ ok: true, state: activeLedger.reset() }));

app.get('/', c => c.html(renderDashboard(activeLedger.snapshot())));

function renderDashboard(state: AgoraState): string {
  const startedAt = state.events[0]?.at ?? new Date().toISOString();
  const modeLabel = process.env.TRUEFOUNDRY_API_KEY?.trim() ? 'LIVE (TF Gateway)' : 'SIMULATION';
  const modeClass = process.env.TRUEFOUNDRY_API_KEY?.trim() ? 'live-mode' : 'sim-mode';
  const proof = proofLine(state);
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
  const tasks = state.tasks.map(renderTask).join('');
  const presetButtons = TASK_PRESETS.map(
    p => `<button class="preset-btn" data-task="${escapeHtml(p.task)}" onclick="setTaskFromPreset(this)">${escapeHtml(p.label)}</button>`,
  ).join('');

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
    .sim-mode { color:#8fa6c9; } .sim-mode i { background:#8fa6c9; }
    .proof { min-height:36px; display:flex; align-items:center; padding:0 32px; border-bottom:1px solid var(--border); background:var(--surface); color:var(--muted); }
    .proof.success { color:#8bd6a8; } .proof.warn { color:#e0b060; }
    .proof span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    main { display:grid; grid-template-columns:minmax(360px,.95fr) minmax(420px,1.05fr); gap:1px; min-height:calc(100vh - 94px); background:var(--border); }
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
    .run-panel { display:grid; gap:8px; }
    .run-row { display:grid; grid-template-columns:1fr auto; gap:8px; }
    .preset-row { display:flex; flex-wrap:wrap; gap:7px; }
    .task-input { min-width:0; height:34px; border:1px solid var(--border); border-radius:2px; background:var(--surface); color:var(--text); padding:0 10px; font:inherit; }
    button { font-family:inherit; font-size:12px; border-radius:2px; cursor:pointer; background:transparent; }
    .preset-btn { border:1px solid var(--border); color:#8fa6c9; padding:6px 10px; }
    .preset-btn:hover { border-color:#8fa6c9; color:#c0d0f0; }
    .run-btn { border:1px solid #6a4a14; color:var(--accent); padding:7px 14px; }
    .run-btn:hover { border-color:var(--accent); color:#ffd080; }
    .chaos-btn { border:1px solid #5a2020; color:#e07070; padding:7px 12px; }
    .chaos-btn:hover { border-color:var(--failed); color:#f0a0a0; }
    .reset-btn { margin-left:auto; border:1px solid var(--border); color:var(--muted); padding:7px 14px; }
    .task { padding:14px; }
    .task h3 { margin:0 0 12px; font-size:15px; font-weight:700; }
    .task-meta, .receipt-row { display:grid; grid-template-columns:140px 1fr; gap:8px; }
    .task-meta span, .receipt-key { color:var(--muted); font-size:12px; }
    .task-meta b, .receipt-val { color:var(--text); font-size:13px; font-weight:400; min-width:0; overflow-wrap:anywhere; }
    .receipt { padding:14px; }
    .artifacts { margin-top:14px; display:grid; gap:10px; }
    .artifact { border:1px solid var(--border); border-radius:2px; padding:10px; background:var(--bg); }
    .artifact h4 { margin:0 0 6px; color:var(--accent); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .artifact p { margin:0; color:var(--text); white-space:pre-wrap; line-height:1.5; }
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
      section, .proof { padding-left:20px; padding-right:20px; }
      .agents { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .run-row { grid-template-columns:1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>AGORA</h1>
    <div style="display:flex;align-items:center;gap:16px">
      <span style="font-size:11px;color:var(--muted);letter-spacing:.08em">TrueFoundry AI Gateway · AWS Bedrock</span>
      <div class="live ${modeClass}"><i></i>${modeLabel}</div>
    </div>
  </header>
  <div class="proof ${proof.className}" id="proof"><span>${escapeHtml(proof.text)}</span></div>
  <main>
    <section class="stack">
      <div>
        <h2 class="section-title">Agent Mesh</h2>
        <div class="agents" id="agents">${agentCards}</div>
      </div>
      <div class="chaos-section">
        <h2 class="section-title">Run Task</h2>
        <div class="run-panel">
          <div class="run-row">
            <input class="task-input" id="taskInput" value="${escapeHtml(DEFAULT_TASK)}">
            <button class="run-btn" onclick="runTask()">Run Task</button>
          </div>
          <div class="preset-row">${presetButtons}</div>
        </div>
        <h2 class="section-title">Chaos Injection</h2>
        <div class="controls">
          <button class="chaos-btn" onclick="injectChaos('lost_agent')">⚡ Provider Outage</button>
          <button class="chaos-btn" onclick="injectChaos('timeout')">⏱ Rate Limit Exceeded</button>
          <button class="chaos-btn" onclick="injectChaos('bad_output')">✕ Malformed Response</button>
          <button class="chaos-btn" onclick="injectChaos('stale_context')">≋ Context Window Exceeded</button>
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
      ['failure kind', failureLabel(r.failureKind)],
      ['recovery status', r.recoveryStatus],
      ['gateway mode', r.gateway?.gateway_mode || 'unknown'],
      ['model used', r.gateway?.model_used || 'unknown'],
      ['fallback triggered', String(Boolean(r.gateway?.fallback_triggered))],
      ['completed parts', (r.completedParts || []).join(', ') || 'none'],
      ['failed parts', (r.failedParts || []).join(', ') || 'none'],
      ['evidence seen', (r.evidenceSeen || []).join(' / ') || 'none'],
    ].map(([k, v]) => '<div class="receipt-row"><div class="receipt-key">' + esc(k) + '</div><div class="receipt-val">' + esc(v) + '</div></div>').join('');
    const renderReceipt = r => '<article class="receipt">' + receiptRows(r) + '<details><summary>view raw JSON</summary><pre>' + esc(JSON.stringify(r, null, 2)) + '</pre></details></article>';
    const failureLabel = kind => ({ lost_agent: 'Provider Outage', timeout: 'Rate Limit Exceeded', bad_output: 'Malformed Response', stale_context: 'Context Window Exceeded' }[kind] || kind || 'provider failure');
    const proofFromState = state => {
      const task = state.tasks?.[0];
      const receipt = state.receipts?.[state.receipts.length - 1];
      if (task?.status === 'degraded') return { className: 'warn', text: 'User deliverable degraded by quality gate; output was not falsely marked complete' };
      if (receipt && task?.status === 'completed') return { className: 'success', text: '✓ User deliverable preserved after ' + failureLabel(receipt.failureKind) };
      if (task?.status === 'completed') return { className: 'success', text: '✓ User deliverable completed and quality-checked' };
      return { className: '', text: 'Run a user deliverable, inject provider failure, and verify the final UX is preserved' };
    };
    const artifactLabel = key => key.split(':').pop() || key;
    const artifactPreview = (key, value) => {
      const label = artifactLabel(key);
      const text = label === 'report' ? value : String(value).split('\\n').slice(0, 4).join('\\n');
      return '<section class="artifact"><h4>' + esc(label) + '</h4><p>' + esc(text) + '</p></section>';
    };
    const renderTask = t => {
      const artifacts = Object.entries(t.artifacts || {}).map(([key, value]) => artifactPreview(key, value)).join('');
      return '<article class="task"><h3>' + esc(t.title) + '</h3><div class="task-meta"><span>Status</span><b>' + esc(t.status) + '</b><span>Assigned</span><b>' + esc(t.assignedAgentId) + '</b><span>Completed</span><b>' + esc((t.completedParts || []).join(', ') || 'none') + '</b><span>Failed</span><b>' + esc((t.failedParts || []).join(', ') || 'none') + '</b></div>' + (artifacts ? '<div class="artifacts">' + artifacts + '</div>' : '') + '</article>';
    };
    function setTaskFromPreset(button) {
      document.getElementById('taskInput').value = button.dataset.task || '';
    }
    async function runTask() {
      const task = document.getElementById('taskInput').value;
      await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task }) });
      await refresh();
    }
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
      const proof = proofFromState(state);
      const proofEl = document.getElementById('proof');
      proofEl.className = 'proof ' + proof.className;
      proofEl.innerHTML = '<span>' + esc(proof.text) + '</span>';
      document.getElementById('agents').innerHTML = state.agents.map(a => '<article class="agent ' + esc(a.status) + '" data-agent-id="' + esc(a.id) + '"><div><strong>' + esc(a.label) + '</strong><span>' + esc(a.role) + '</span></div><em><i></i>' + esc(a.status) + '</em></article>').join('');
      document.getElementById('tasks').innerHTML = state.tasks.map(renderTask).join('');
      document.getElementById('receipts').innerHTML = state.receipts.length ? state.receipts.map(renderReceipt).join('') : '<p class="empty">No handoff yet. Inject chaos to prove recovery.</p>';
      document.getElementById('events').innerHTML = [...state.events].reverse().slice(0, 12).map(e => '<li class="' + esc(e.severity) + '"><time>' + relativeTime(startedAt, e.at) + '</time><b>' + severityCode(e.severity) + '</b><span>' + esc(e.message) + '</span></li>').join('');
    }
    setInterval(refresh, 1500);
  </script>
</body>
</html>`;
}

function renderTask(task: TaskRecord): string {
  const artifacts = Object.entries(task.artifacts ?? {})
    .map(([key, value]) => renderArtifact(key, value))
    .join('');
  return `<article class="task">
    <h3>${escapeHtml(task.title)}</h3>
    <div class="task-meta">
      <span>Status</span><b>${escapeHtml(task.status)}</b>
      <span>Assigned</span><b>${escapeHtml(task.assignedAgentId)}</b>
      <span>Completed</span><b>${escapeHtml(task.completedParts.join(', ') || 'none')}</b>
      <span>Failed</span><b>${escapeHtml(task.failedParts.join(', ') || 'none')}</b>
    </div>
    ${artifacts ? `<div class="artifacts">${artifacts}</div>` : ''}
  </article>`;
}

function renderArtifact(key: string, value: string): string {
  const label = key.split(':').pop() ?? key;
  const text = label === 'report' ? value : value.split('\n').slice(0, 4).join('\n');
  return `<section class="artifact"><h4>${escapeHtml(label)}</h4><p>${escapeHtml(text)}</p></section>`;
}

function renderReceipt(receipt: AgoraState['receipts'][number]): string {
  const pairs: Array<[string, string]> = [
    ['failed agent', receipt.failedAgentId],
    ['takeover agent', receipt.takeoverAgentId],
    ['failure kind', failureLabel(receipt.failureKind)],
    ['recovery status', receipt.recoveryStatus],
    ['gateway mode', receipt.gateway?.gateway_mode ?? 'unknown'],
    ['model used', receipt.gateway?.model_used ?? 'unknown'],
    ['fallback triggered', String(Boolean(receipt.gateway?.fallback_triggered))],
    ['completed parts', receipt.completedParts.join(', ') || 'none'],
    ['failed parts', receipt.failedParts.join(', ') || 'none'],
    ['evidence seen', receipt.evidenceSeen.join(' / ') || 'none'],
  ];
  const rows = pairs.map(([key, value]) => `<div class="receipt-row"><div class="receipt-key">${escapeHtml(key)}</div><div class="receipt-val">${escapeHtml(value)}</div></div>`).join('');
  return `<article class="receipt">${rows}<details><summary>view raw JSON</summary><pre>${escapeHtml(JSON.stringify(receipt, null, 2))}</pre></details></article>`;
}

function proofLine(state: AgoraState): { className: string; text: string } {
  const task = state.tasks[0];
  const receipt = state.receipts.at(-1);
  if (task?.status === 'degraded') {
    return {
      className: 'warn',
      text: 'User deliverable degraded by quality gate; output was not falsely marked complete',
    };
  }
  if (receipt && task?.status === 'completed') {
    return {
      className: 'success',
      text: `✓ User deliverable preserved after ${failureLabel(receipt.failureKind)}`,
    };
  }
  if (task?.status === 'completed') {
    return { className: 'success', text: '✓ User deliverable completed and quality-checked' };
  }
  return {
    className: '',
    text: 'Run a user deliverable, inject provider failure, and verify the final UX is preserved',
  };
}

function failureLabel(kind: string): string {
  return (
    {
      lost_agent: 'Provider Outage',
      timeout: 'Rate Limit Exceeded',
      bad_output: 'Malformed Response',
      stale_context: 'Context Window Exceeded',
    } as Record<string, string>
  )[kind] ?? kind;
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
