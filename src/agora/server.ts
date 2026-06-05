import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildJudgePacket, type JudgePacket } from './judge-packet.js';
import { activeLedger, getChaosControlState, runAgentTask, runRecoveryDemo, setPendingChaos } from './runner.js';
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

type DashboardState = AgoraState & { control: ReturnType<typeof getChaosControlState> };

function currentState(): DashboardState {
  return { ...activeLedger.snapshot(), control: getChaosControlState() };
}

function currentGatewayMode(): JudgePacket['gateway_mode'] {
  return process.env.AGORA_FORCE_SIMULATION === '1' || !process.env.TRUEFOUNDRY_API_KEY?.trim()
    ? 'simulation'
    : 'live';
}

function stateGatewayMode(state: AgoraState): JudgePacket['gateway_mode'] {
  return state.receipts.at(-1)?.gateway?.gateway_mode ?? currentGatewayMode();
}

function normalizeFailureKind(value: string | undefined): FailureKind {
  const allowed: FailureKind[] = [
    'timeout',
    'bad_output',
    'contradiction',
    'stale_context',
    'tool_error',
    'lost_agent',
    'human_boundary',
  ];
  return allowed.includes(value as FailureKind) ? (value as FailureKind) : 'lost_agent';
}

app.get('/api/state', c => c.json(currentState()));

app.get('/health', c =>
  c.json({
    ok: true,
    service: 'agora',
    gateway_mode: currentGatewayMode(),
    uptime_seconds: Math.round(process.uptime()),
  }),
);

app.post('/api/chaos/:kind', c => {
  const kind = c.req.param('kind') as FailureKind;
  const wasOpen = getChaosControlState().chaos_window_open;
  setPendingChaos(kind || 'lost_agent');
  activeLedger.event(
    'warn',
    wasOpen ? `Chaos injected into active run: ${kind}` : `Chaos armed for next run: ${kind}`,
    'watchdog',
    undefined,
    'watchdog',
  );
  return c.json({ ok: true, mode: wasOpen ? 'immediate' : 'armed', armed: kind, state: currentState() });
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

app.post('/api/demo/recovery', async c => {
  let body: { task?: string; failureKind?: string } = {};
  try {
    body = await c.req.json<{ task?: string; failureKind?: string }>();
  } catch {
    body = {};
  }
  const topic = body.task?.trim() || DEFAULT_TASK;
  const failureKind = normalizeFailureKind(body.failureKind);
  const result = await runRecoveryDemo(topic, failureKind);
  return c.json({
    ok: true,
    demo_mode: 'deterministic_simulation',
    failure_kind: failureKind,
    result,
    judge_packet: buildJudgePacket(currentState(), stateGatewayMode(currentState())),
  });
});

app.get('/api/judge-packet', c => c.json(buildJudgePacket(currentState(), stateGatewayMode(currentState()))));

app.post('/api/reset', c => {
  activeLedger.reset();
  return c.json({ ok: true, state: currentState() });
});

app.get('/', c => c.html(renderDashboard(currentState())));

function renderDashboard(state: DashboardState): string {
  const startedAt = state.events[0]?.at ?? new Date().toISOString();
  const modeLabel = stateGatewayMode(state) === 'live' ? 'LIVE (TF Gateway)' : 'SIMULATION';
  const modeClass = stateGatewayMode(state) === 'live' ? 'live-mode' : 'sim-mode';
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
  const evidencePanel = renderJudgingEvidence(state);
  const reviewLoopPanel = renderReviewLoop(state);
  const judgePanel = renderJudgePacket(buildJudgePacket(state, stateGatewayMode(state)));
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
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font-size:13px; overflow-x:hidden; }
    header { min-height:58px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:10px 32px; border-bottom:1px solid var(--border); }
    h1 { margin:0; font-size:28px; line-height:1; letter-spacing:.15em; font-weight:700; }
    .header-right { display:grid; justify-items:end; gap:4px; min-width:0; }
    .live { display:flex; align-items:center; gap:7px; color:var(--accent); font-size:12px; letter-spacing:.12em; }
    .live i { width:7px; height:7px; border-radius:50%; background:var(--accent); display:block; }
    .platform { color:var(--muted); font-size:11px; text-align:right; letter-spacing:.08em; }
    .sim-mode { color:#8fa6c9; } .sim-mode i { background:#8fa6c9; }
    .proof { min-height:36px; display:flex; align-items:center; padding:0 32px; border-bottom:1px solid var(--border); background:var(--surface); color:var(--muted); }
    .proof.success { color:#8bd6a8; } .proof.warn { color:#e0b060; }
    .proof span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    main { display:grid; grid-template-columns:minmax(360px,.95fr) minmax(420px,1.05fr); gap:1px; width:100%; max-width:100vw; min-height:calc(100vh - 94px); background:var(--border); overflow-x:hidden; }
    section { min-width:0; max-width:100vw; overflow:hidden; background:var(--bg); padding:24px 32px; }
    .stack { display:grid; gap:22px; align-content:start; }
    .section-title { margin:0 0 10px; color:var(--muted); font-size:11px; letter-spacing:.12em; text-transform:uppercase; font-weight:700; }
    .agents { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .agent, .task, .receipt, .timeline { background:var(--surface); border:1px solid var(--border); border-radius:2px; }
    .agent { min-height:94px; display:grid; align-content:space-between; gap:14px; padding:12px 14px; border-left-width:4px; }
    .agent.healthy { border-left-color:var(--healthy); } .agent.busy { border-left-color:var(--busy); }
    .agent.failed { border-left-color:var(--failed); } .agent.degraded { border-left-color:var(--degraded); }
    .agent strong { display:block; font-size:13px; font-weight:700; overflow-wrap:anywhere; }
    .agent span { display:block; margin-top:3px; color:var(--muted); font-size:11px; overflow-wrap:anywhere; }
    .agent em { display:flex; align-items:center; color:var(--status-color,var(--muted)); font-style:normal; font-size:11px; text-transform:uppercase; }
    .agent em i { width:6px; height:6px; border-radius:50%; display:inline-block; margin-right:6px; background:currentColor; }
    .agent.healthy em { color:var(--healthy); } .agent.busy em { color:var(--busy); }
    .agent.failed em { color:var(--failed); } .agent.degraded em { color:var(--degraded); }
    .evidence-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
    .evidence-item { min-width:0; border:1px solid var(--border); border-radius:2px; padding:9px 10px; background:var(--surface); }
    .evidence-item.pass { border-color:#214d36; }
    .evidence-item.pending { border-color:#343844; }
    .evidence-item strong { display:block; color:var(--text); font-size:12px; margin-bottom:4px; }
    .evidence-item span { display:block; color:var(--muted); font-size:11px; line-height:1.4; overflow-wrap:anywhere; }
    .evidence-item.pass span { color:#8bd6a8; }
    .review-loop { border:1px solid var(--border); border-radius:2px; padding:12px; background:var(--surface); display:grid; gap:9px; }
    .review-loop.pass { border-color:#214d36; }
    .review-loop.pending { color:var(--muted); }
    .review-row { display:grid; grid-template-columns:112px 1fr; gap:8px; align-items:start; }
    .review-key { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .review-val { color:var(--text); font-size:12px; line-height:1.45; overflow-wrap:anywhere; }
    .review-loop.pass .review-val:first-letter { color:#8bd6a8; }
    .judge-panel { border:1px solid var(--border); border-radius:2px; padding:12px; background:var(--surface); display:grid; gap:10px; }
    .judge-panel.demo_ready { border-color:#214d36; }
    .judge-panel.evidence_partial { border-color:#6a4a14; }
    .judge-score { display:grid; grid-template-columns:auto 1fr; gap:10px; align-items:center; }
    .score-num { color:var(--accent); font-size:24px; line-height:1; font-weight:700; }
    .score-copy { color:var(--muted); font-size:11px; line-height:1.45; overflow-wrap:anywhere; }
    .score-copy strong { display:block; color:var(--text); font-size:12px; margin-bottom:2px; }
    .criteria-mini { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
    .criteria-mini span { min-width:0; border:1px solid var(--border); border-radius:2px; color:var(--muted); padding:5px 7px; font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .criteria-mini span.pass { color:#8bd6a8; border-color:#214d36; }
    .controls { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
    .chaos-indicator { display:inline-flex; align-items:center; min-height:26px; border:1px solid var(--border); color:var(--muted); padding:5px 8px; margin-bottom:8px; font-size:11px; }
    .chaos-indicator.ready { border-color:#6a4a14; color:var(--accent); }
    .chaos-indicator.armed { border-color:#5a2020; color:#e07070; }
    .run-panel { display:grid; gap:8px; }
    .run-row { display:grid; grid-template-columns:1fr auto auto; gap:8px; }
    .preset-row { display:flex; flex-wrap:wrap; gap:7px; }
    .task-input { min-width:0; height:34px; border:1px solid var(--border); border-radius:2px; background:var(--surface); color:var(--text); padding:0 10px; font:inherit; }
    button { font-family:inherit; font-size:12px; border-radius:2px; cursor:pointer; background:transparent; }
    .preset-btn { border:1px solid var(--border); color:#8fa6c9; padding:6px 10px; }
    .preset-btn:hover { border-color:#8fa6c9; color:#c0d0f0; }
    .run-btn { border:1px solid #6a4a14; color:var(--accent); padding:7px 14px; }
    .run-btn:hover { border-color:var(--accent); color:#ffd080; }
    .demo-btn { border:1px solid #214d36; color:#8bd6a8; padding:7px 14px; }
    .demo-btn:hover { border-color:#8bd6a8; color:#c0f0d0; }
    .packet-btn { border:1px solid var(--border); color:#8fa6c9; padding:7px 14px; }
    .packet-btn:hover { border-color:#8fa6c9; color:#c0d0f0; }
    .chaos-btn { border:1px solid #5a2020; color:#e07070; padding:7px 12px; }
    .chaos-btn:hover { border-color:var(--failed); color:#f0a0a0; }
    .reset-btn { margin-left:auto; border:1px solid var(--border); color:var(--muted); padding:7px 14px; }
    .task { padding:14px; }
    .task h3 { margin:0 0 12px; font-size:15px; font-weight:700; overflow-wrap:anywhere; }
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
      header { align-items:flex-start; padding:10px 20px; }
    }
    @media (max-width: 420px) {
      header { padding-left:14px; padding-right:14px; }
      section, .proof { padding-left:14px; padding-right:14px; }
      .agents { grid-template-columns:1fr; }
      .evidence-grid { grid-template-columns:1fr; }
      .criteria-mini { grid-template-columns:1fr; }
      .task-meta, .receipt-row { grid-template-columns:1fr; }
      .timeline li { grid-template-columns:46px 18px 1fr; }
      .statusbar { left:14px; right:14px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>AGORA</h1>
    <div class="header-right">
      <div class="live ${modeClass}"><i></i>${modeLabel}</div>
      <div class="platform">Powered by TrueFoundry AI Gateway + AWS Bedrock fallback</div>
    </div>
  </header>
  <div class="proof ${proof.className}" id="proof"><span>${escapeHtml(proof.text)}</span></div>
  <main>
    <section class="stack">
      <div>
        <h2 class="section-title">Agent Mesh</h2>
        <div class="agents" id="agents">${agentCards}</div>
      </div>
      <div>
        <h2 class="section-title">Judging Evidence</h2>
        <div class="evidence-grid" id="evidence">${evidencePanel}</div>
      </div>
      <div>
        <h2 class="section-title">Review Loop</h2>
        <div id="reviewLoop">${reviewLoopPanel}</div>
      </div>
      <div>
        <h2 class="section-title">Judge Packet</h2>
        <div id="judgePacket">${judgePanel}</div>
      </div>
      <div class="chaos-section">
        <h2 class="section-title">Run Task</h2>
        <div class="run-panel">
          <div class="run-row">
            <input class="task-input" id="taskInput" value="${escapeHtml(DEFAULT_TASK)}">
            <button class="run-btn" onclick="runTask()">Run Task</button>
            <button class="demo-btn" onclick="runJudgeDemo()">Judge Demo</button>
          </div>
          <div class="preset-row">${presetButtons}</div>
          <div class="preset-row">
            <button class="packet-btn" onclick="downloadJudgePacket()">Download Judge Packet</button>
          </div>
        </div>
        <h2 class="section-title">Chaos Injection</h2>
        <div class="chaos-indicator ${chaosIndicator(state.control).className}" id="chaosIndicator">${escapeHtml(chaosIndicator(state.control).text)}</div>
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
      ['fallback meaning', r.gateway?.fallback_triggered ? 'TF Gateway fallback chain engaged; AWS Bedrock carried the request' : 'primary route or simulation path'],
      ['completed parts', (r.completedParts || []).join(', ') || 'none'],
      ['failed parts', (r.failedParts || []).join(', ') || 'none'],
      ['evidence seen', (r.evidenceSeen || []).join(' / ') || 'none'],
    ].map(([k, v]) => '<div class="receipt-row"><div class="receipt-key">' + esc(k) + '</div><div class="receipt-val">' + esc(v) + '</div></div>').join('');
    const renderReceipt = r => '<article class="receipt">' + receiptRows(r) + '<details><summary>view raw JSON</summary><pre>' + esc(JSON.stringify(r, null, 2)) + '</pre></details></article>';
    const chaosIndicator = control => {
      if (control?.chaos_window_open) return { className: 'ready', text: 'READY: inject provider failure into active run' };
      if (control?.pending_chaos) return { className: 'armed', text: 'ARMED: ' + failureLabel(control.pending_chaos) + ' on next run' };
      return { className: '', text: 'STANDBY: run task, then inject provider failure' };
    };
    const failureLabel = kind => ({ lost_agent: 'Provider Outage', timeout: 'Rate Limit Exceeded', bad_output: 'Malformed Response', stale_context: 'Context Window Exceeded' }[kind] || kind || 'provider failure');
    const gatewaySuffix = gateway => gateway?.fallback_triggered ? ' via TF Gateway + AWS Bedrock fallback' : '';
    const proofFromState = state => {
      const task = state.tasks?.[0];
      const receipt = state.receipts?.[state.receipts.length - 1];
      if (task?.status === 'degraded') return { className: 'warn', text: 'User deliverable degraded by quality gate; output was not falsely marked complete' };
      if (receipt && task?.status === 'completed') return { className: 'success', text: '✓ User deliverable preserved after ' + failureLabel(receipt.failureKind) + gatewaySuffix(receipt.gateway) };
      if (task?.status === 'completed') return { className: 'success', text: '✓ User deliverable completed and quality-checked' };
      return { className: '', text: 'Run a user deliverable, inject provider failure, and verify the final UX is preserved' };
    };
    const artifactLabel = key => key.split(':').pop() || key;
    const artifactValue = (state, suffix) => {
      const artifacts = state.tasks?.[0]?.artifacts || {};
      const entry = Object.entries(artifacts).find(([key]) => key.endsWith(suffix));
      return entry ? entry[1] : '';
    };
    const hasArtifact = (state, suffix) => Boolean(artifactValue(state, suffix));
    const evidenceFromState = state => [
      ['TF Gateway', state.events?.some(e => e.type === 'gateway'), 'gateway evidence recorded'],
      ['MCP Tool Policy', hasArtifact(state, 'mcp_tool_audit'), 'READ_HEDGE tool audit in ledger'],
      ['Guardrails', hasArtifact(state, 'guardrail_decision'), 'input/tool/output decisions saved'],
      ['Mid-task Chaos', state.events?.some(e => e.type === 'chaos_window'), 'live injection window opened'],
      ['Critic Loop', Object.keys(state.tasks?.[0]?.artifacts || {}).some(k => k.includes('critic_round')), 'Builder-Critic revision recorded'],
      ['Verifier Gate', hasArtifact(state, 'verdict'), 'rubric final decision saved'],
    ];
    const renderEvidencePanel = state => evidenceFromState(state).map(([label, ok, detail]) => '<article class="evidence-item ' + (ok ? 'pass' : 'pending') + '"><strong>' + esc(label) + '</strong><span>' + esc(ok ? detail : 'pending run evidence') + '</span></article>').join('');
    const artifactValues = state => Object.values(state.tasks?.[0]?.artifacts || {});
    const hasArtifactValue = (state, needle) => artifactValues(state).some(value => String(value).includes(needle));
    const judgeCriteriaFromState = state => [
      ['TF Gateway', state.events?.some(e => e.type === 'gateway')],
      ['MCP Policy', hasArtifact(state, 'mcp_tool_audit') && hasArtifactValue(state, 'READ_HEDGE')],
      ['Guardrails', hasArtifact(state, 'guardrail_decision')],
      ['Recovery', Boolean(state.receipts?.length) && state.tasks?.[0]?.status === 'completed'],
      ['Critic Loop', Object.keys(state.tasks?.[0]?.artifacts || {}).some(k => k.includes(':critic_round')) && Object.keys(state.tasks?.[0]?.artifacts || {}).some(k => k.includes('report_after_critic_round'))],
      ['Verifier', hasArtifact(state, 'verdict') && state.tasks?.[0]?.status === 'completed'],
    ];
    const renderJudgePacketPanel = state => {
      const criteria = judgeCriteriaFromState(state);
      const passed = criteria.filter(([, ok]) => ok).length;
      const score = Math.round((passed / criteria.length) * 100);
      const label = score === 100 ? 'demo_ready' : score >= 60 ? 'evidence_partial' : 'needs_run';
      const summary = label === 'demo_ready'
        ? 'Complete recovery packet ready for judges.'
        : label === 'evidence_partial'
          ? 'Partial evidence exists. Run Judge Demo to complete it.'
          : 'Run Judge Demo to create a recovery packet.';
      const mini = criteria.map(([name, ok]) => '<span class="' + (ok ? 'pass' : 'pending') + '">' + esc((ok ? 'PASS ' : 'PEND ') + name) + '</span>').join('');
      return '<article class="judge-panel ' + label + '"><div class="judge-score"><div class="score-num">' + score + '</div><div class="score-copy"><strong>' + esc(label.replace(/_/g, ' ')) + '</strong>' + esc(summary) + '</div></div><div class="criteria-mini">' + mini + '</div></article>';
    };
    const latestArtifactEntry = (state, needle) => Object.entries(state.tasks?.[0]?.artifacts || {}).filter(([key]) => key.includes(needle)).pop();
    const parseJson = value => {
      try { return JSON.parse(value); } catch { return null; }
    };
    const renderReviewLoopPanel = state => {
      const criticEntry = latestArtifactEntry(state, ':critic_round');
      const revisionEntry = latestArtifactEntry(state, 'report_after_critic_round');
      const feedback = criticEntry ? parseJson(criticEntry[1]) : null;
      if (!feedback) return '<article class="review-loop pending">Run a task to show Critic feedback and Builder revision.</article>';
      const issues = Array.isArray(feedback.issues) ? feedback.issues.length : 0;
      const revisionLabel = revisionEntry ? revisionEntry[0].split(':').pop() : 'not saved yet';
      return '<article class="review-loop pass">'
        + '<div class="review-row"><div class="review-key">Critic</div><div class="review-val">' + esc(feedback.severity || 'none') + ' / ' + issues + ' issue(s)</div></div>'
        + '<div class="review-row"><div class="review-key">Guidance</div><div class="review-val">' + esc(String(feedback.revised_guidance || 'No guidance').slice(0, 220)) + '</div></div>'
        + '<div class="review-row"><div class="review-key">Builder</div><div class="review-val">' + esc(revisionLabel) + '</div></div>'
        + '</article>';
    };
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
    async function runJudgeDemo() {
      const task = document.getElementById('taskInput').value;
      await fetch('/api/demo/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, failureKind: 'lost_agent' }) });
      await refresh();
    }
    async function downloadJudgePacket() {
      const packet = await fetch('/api/judge-packet').then(r => r.json());
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'agora-judge-packet.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
      const chaos = chaosIndicator(state.control);
      const chaosEl = document.getElementById('chaosIndicator');
      chaosEl.className = 'chaos-indicator ' + chaos.className;
      chaosEl.textContent = chaos.text;
      document.getElementById('agents').innerHTML = state.agents.map(a => '<article class="agent ' + esc(a.status) + '" data-agent-id="' + esc(a.id) + '"><div><strong>' + esc(a.label) + '</strong><span>' + esc(a.role) + '</span></div><em><i></i>' + esc(a.status) + '</em></article>').join('');
      document.getElementById('evidence').innerHTML = renderEvidencePanel(state);
      document.getElementById('reviewLoop').innerHTML = renderReviewLoopPanel(state);
      document.getElementById('judgePacket').innerHTML = renderJudgePacketPanel(state);
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

function renderJudgingEvidence(state: AgoraState): string {
  return judgingEvidence(state)
    .map(
      item =>
        `<article class="evidence-item ${item.ok ? 'pass' : 'pending'}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.ok ? item.detail : 'pending run evidence')}</span></article>`,
    )
    .join('');
}

function judgingEvidence(state: AgoraState): Array<{ label: string; ok: boolean; detail: string }> {
  const artifacts = state.tasks[0]?.artifacts ?? {};
  const hasArtifact = (suffix: string): boolean => Object.keys(artifacts).some(key => key.endsWith(suffix));
  return [
    { label: 'TF Gateway', ok: state.events.some(e => e.type === 'gateway'), detail: 'gateway evidence recorded' },
    { label: 'MCP Tool Policy', ok: hasArtifact('mcp_tool_audit'), detail: 'READ_HEDGE tool audit in ledger' },
    { label: 'Guardrails', ok: hasArtifact('guardrail_decision'), detail: 'input/tool/output decisions saved' },
    { label: 'Mid-task Chaos', ok: state.events.some(e => e.type === 'chaos_window'), detail: 'live injection window opened' },
    {
      label: 'Critic Loop',
      ok: Object.keys(artifacts).some(key => key.includes('critic_round')),
      detail: 'Builder-Critic revision recorded',
    },
    { label: 'Verifier Gate', ok: hasArtifact('verdict'), detail: 'rubric final decision saved' },
  ];
}

function renderReviewLoop(state: AgoraState): string {
  const artifacts = state.tasks[0]?.artifacts ?? {};
  const criticEntry = Object.entries(artifacts)
    .filter(([key]) => key.includes(':critic_round'))
    .at(-1);
  const revisionEntry = Object.entries(artifacts)
    .filter(([key]) => key.includes('report_after_critic_round'))
    .at(-1);
  if (!criticEntry) {
    return '<article class="review-loop pending">Run a task to show Critic feedback and Builder revision.</article>';
  }

  const feedback = parseJsonObject(criticEntry[1]);
  const issues = Array.isArray(feedback?.issues) ? feedback.issues.length : 0;
  const severity = typeof feedback?.severity === 'string' ? feedback.severity : 'unknown';
  const guidance =
    typeof feedback?.revised_guidance === 'string'
      ? feedback.revised_guidance.slice(0, 220)
      : 'No revised guidance recorded.';
  const revisionLabel = revisionEntry?.[0].split(':').pop() ?? 'not saved yet';

  return `<article class="review-loop pass">
    <div class="review-row"><div class="review-key">Critic</div><div class="review-val">${escapeHtml(severity)} / ${issues} issue(s)</div></div>
    <div class="review-row"><div class="review-key">Guidance</div><div class="review-val">${escapeHtml(guidance)}</div></div>
    <div class="review-row"><div class="review-key">Builder</div><div class="review-val">${escapeHtml(revisionLabel)}</div></div>
  </article>`;
}

function renderJudgePacket(packet: JudgePacket): string {
  const criteria = packet.criteria
    .map(
      criterion =>
        `<span class="${criterion.passed ? 'pass' : 'pending'}">${escapeHtml(`${criterion.passed ? 'PASS' : 'PEND'} ${criterion.label}`)}</span>`,
    )
    .join('');
  return `<article class="judge-panel ${packet.readiness_label}">
    <div class="judge-score">
      <div class="score-num">${packet.readiness_score}</div>
      <div class="score-copy"><strong>${escapeHtml(packet.readiness_label.replace(/_/g, ' '))}</strong>${escapeHtml(packet.summary)}</div>
    </div>
    <div class="criteria-mini">${criteria}</div>
  </article>`;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
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
    [
      'fallback meaning',
      receipt.gateway?.fallback_triggered
        ? 'TF Gateway fallback chain engaged; AWS Bedrock carried the request'
        : 'primary route or simulation path',
    ],
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
      text: `✓ User deliverable preserved after ${failureLabel(receipt.failureKind)}${gatewaySuffix(receipt.gateway)}`,
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

function gatewaySuffix(gateway: AgoraState['receipts'][number]['gateway']): string {
  return gateway?.fallback_triggered ? ' via TF Gateway + AWS Bedrock fallback' : '';
}

function chaosIndicator(control: ReturnType<typeof getChaosControlState>): { className: string; text: string } {
  if (control.chaos_window_open) {
    return { className: 'ready', text: 'READY: inject provider failure into active run' };
  }
  if (control.pending_chaos) {
    return { className: 'armed', text: `ARMED: ${failureLabel(control.pending_chaos)} on next run` };
  }
  return { className: '', text: 'STANDBY: run task, then inject provider failure' };
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
