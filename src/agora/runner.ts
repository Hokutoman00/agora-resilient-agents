import { applyRedactions, localInputCheck, type GuardrailReport } from '../aegis/guardrails.js';
import { buildHandoffReceipt } from './handoff-receipt.js';
import { TaskLedger } from './ledger.js';
import { runBuilder } from './agents/builder.js';
import { runCritic, type CriticFeedback } from './agents/critic.js';
import { runResearcher } from './agents/researcher.js';
import { shouldUseSimulation } from './agents/runtime.js';
import { runVerifier } from './agents/verifier.js';
import { collectMCPAuditEvidence } from './mcp-evidence.js';
import type { FailureKind, GatewayEvidence } from './types.js';

const TASK_ID = 'task-agora-demo';
const CHAOS_WINDOW_MS = Number(process.env.AGORA_CHAOS_WINDOW_MS ?? 1500);

export type RunResult = {
  runId: string;
  topic: string;
  status: 'completed' | 'failed' | 'recovered' | 'degraded';
  artifacts: { research?: string; mcp?: string; report?: string; critic?: string; verdict?: string; guardrail?: string };
  ledger: ReturnType<TaskLedger['snapshot']>;
};

export const activeLedger = new TaskLedger();

let pendingChaos: FailureKind | null = null;
let chaosWindowOpen = false;

export function setPendingChaos(kind: FailureKind): void {
  pendingChaos = kind;
}

export function getChaosControlState(): { chaos_window_open: boolean; pending_chaos: FailureKind | null } {
  return { chaos_window_open: chaosWindowOpen, pending_chaos: pendingChaos };
}

export async function runAgentTask(topic: string): Promise<RunResult> {
  const runId = `run-${Date.now()}`;
  const artifacts: RunResult['artifacts'] = {};
  const gateway = gatewayEvidence(false);
  const inputGuardrail = localInputCheck(topic, 'input');
  const guardedTopic = applyGuardrailToText(topic, inputGuardrail);
  const guardrails = { input: inputGuardrail } as {
    input: GuardrailReport;
    tool?: GuardrailReport;
    report?: GuardrailReport;
    critic?: GuardrailReport;
    verdict?: GuardrailReport;
  };

  activeLedger.reset();
  activeLedger.startTask(TASK_ID, guardedTopic, 'planner-1');
  activeLedger.event(
    'info',
    `Gateway evidence: ${JSON.stringify(gateway)}`,
    'planner-1',
    TASK_ID,
    'gateway',
  );
  activeLedger.saveArtifact(TASK_ID, 'planner-1', 'guardrail_decision', serializeGuardrails(guardrails));
  activeLedger.event(
    inputGuardrail.decision === 'block' ? 'warn' : 'info',
    `Input guardrail decision: ${inputGuardrail.decision}`,
    'planner-1',
    TASK_ID,
    'guardrail',
  );
  artifacts.guardrail = serializeGuardrails(guardrails);

  if (inputGuardrail.decision === 'block') {
    activeLedger.degrade(TASK_ID, 'input guardrail blocked the task');
    return {
      runId,
      topic: guardedTopic,
      status: 'degraded',
      artifacts,
      ledger: activeLedger.snapshot(),
    };
  }

  activeLedger.markAgent('researcher-1', 'busy', TASK_ID);
  activeLedger.event('info', 'Researcher starting through TF Gateway or simulation fallback', 'researcher-1', TASK_ID);
  const research = await runResearcher(guardedTopic);
  activeLedger.saveArtifact(TASK_ID, 'researcher-1', 'research', research);
  activeLedger.markAgent('researcher-1', 'healthy');
  activeLedger.event('success', 'Research complete', 'researcher-1', TASK_ID);
  artifacts.research = research;

  activeLedger.event('info', 'MCP tool audit starting: search_outage_signals', 'planner-1', TASK_ID, 'mcp_tool');
  const mcpEvidence = await collectMCPAuditEvidence(guardedTopic, research);
  let mcpEvidenceJson = JSON.stringify(mcpEvidence, null, 2);
  const toolGuardrail = localInputCheck(mcpEvidenceJson, 'tool_result');
  guardrails.tool = toolGuardrail;
  mcpEvidenceJson = applyGuardrailToText(mcpEvidenceJson, toolGuardrail);
  activeLedger.saveArtifact(TASK_ID, 'planner-1', 'mcp_tool_audit', mcpEvidenceJson);
  activeLedger.saveArtifact(TASK_ID, 'planner-1', 'guardrail_decision', serializeGuardrails(guardrails));
  activeLedger.event(
    toolGuardrail.decision === 'block' ? 'warn' : 'success',
    `MCP tool audit: ${mcpEvidence.classification.klass}, winner=${mcpEvidence.hedge_record.winner}, mode=${mcpEvidence.gateway_mode}`,
    'planner-1',
    TASK_ID,
    'mcp_tool',
  );
  artifacts.mcp = mcpEvidenceJson;
  artifacts.guardrail = serializeGuardrails(guardrails);
  if (toolGuardrail.decision === 'block') {
    activeLedger.degrade(TASK_ID, 'MCP tool audit blocked by tool-result guardrail');
    return {
      runId,
      topic: guardedTopic,
      status: 'degraded',
      artifacts,
      ledger: activeLedger.snapshot(),
    };
  }

  activeLedger.markAgent('builder-1', 'busy', TASK_ID);
  activeLedger.event('info', 'Builder synthesizing report', 'builder-1', TASK_ID);

  activeLedger.event(
    'info',
    `Mid-task chaos window open (${CHAOS_WINDOW_MS}ms)`,
    'watchdog',
    TASK_ID,
    'chaos_window',
  );
  chaosWindowOpen = true;
  try {
    await delay(CHAOS_WINDOW_MS);
  } finally {
    chaosWindowOpen = false;
  }

  const chaos = pendingChaos;
  pendingChaos = null;

  let report: string;
  if (chaos) {
    activeLedger.event('warn', `Chaos injected: ${chaos} on builder-1`, 'recovery-1', TASK_ID, 'watchdog');
    activeLedger.markAgent('builder-1', 'failed', TASK_ID);

    const task = activeLedger.snapshot().tasks.find(t => t.id === TASK_ID);
    if (!task) throw new Error(`unknown task: ${TASK_ID}`);

    const recoveryGateway = gatewayEvidence(true);
    activeLedger.event(
      'success',
      `TF Gateway fallback chain engaged: ${recoveryGateway.model_used} via AWS Bedrock fallback`,
      'recovery-1',
      TASK_ID,
      'gateway',
    );
    const receipt = buildHandoffReceipt({
      failedAgentId: 'builder-1',
      takeoverAgentId: 'recovery-1',
      task,
      failureKind: chaos,
      gateway: recoveryGateway,
      evidenceSeen: [
        `research artifact preserved in shared ledger (${research.length} chars)`,
        `watchdog detected ${chaos} on builder-1`,
        'Recovery Coordinator reconstructed the task from ledger state',
      ],
    });
    activeLedger.applyReceipt(receipt);

    activeLedger.markAgent('recovery-1', 'busy', TASK_ID);
    report = await runBuilder(research, '障害前の Builder 出力は未完了です。');
    activeLedger.markAgent('recovery-1', 'healthy');
    activeLedger.event('success', 'Recovery complete. Report generated.', 'recovery-1', TASK_ID);
  } else {
    report = await runBuilder(research);
    activeLedger.markAgent('builder-1', 'healthy');
    activeLedger.event('success', 'Report generated', 'builder-1', TASK_ID);
  }

  const reportGuardrail = localInputCheck(report, 'output');
  guardrails.report = reportGuardrail;
  report = applyGuardrailToText(report, reportGuardrail);
  activeLedger.saveArtifact(TASK_ID, 'planner-1', 'guardrail_decision', serializeGuardrails(guardrails));
  activeLedger.event(
    reportGuardrail.decision === 'block' ? 'warn' : 'info',
    `Report guardrail decision: ${reportGuardrail.decision}`,
    'planner-1',
    TASK_ID,
    'guardrail',
  );
  if (reportGuardrail.decision === 'block') {
    activeLedger.saveArtifact(TASK_ID, 'guardrail-1', 'blocked_report', report);
    activeLedger.degrade(TASK_ID, 'report guardrail blocked the recovered output');
    artifacts.report = report;
    artifacts.guardrail = serializeGuardrails(guardrails);
    return {
      runId,
      topic: guardedTopic,
      status: 'degraded',
      artifacts,
      ledger: activeLedger.snapshot(),
    };
  }
  activeLedger.saveArtifact(TASK_ID, chaos ? 'recovery-1' : 'builder-1', 'report', report);
  artifacts.report = report;

  const criticResult = await runCriticLoop({
    topic: guardedTopic,
    research,
    report,
    currentOwnerId: chaos ? 'recovery-1' : 'builder-1',
    guardrails,
  });
  if (criticResult.status === 'degraded') {
    artifacts.report = criticResult.report;
    artifacts.critic = JSON.stringify(criticResult.feedback, null, 2);
    artifacts.guardrail = serializeGuardrails(guardrails);
    return {
      runId,
      topic: guardedTopic,
      status: 'degraded',
      artifacts,
      ledger: activeLedger.snapshot(),
    };
  }
  report = criticResult.report;
  artifacts.report = report;
  artifacts.critic = JSON.stringify(criticResult.feedback, null, 2);

  activeLedger.markAgent('verifier-1', 'busy', TASK_ID);
  let verification = await runVerifier(report);
  if (!verification.overall_pass) {
    activeLedger.saveArtifact(TASK_ID, 'verifier-1', 'verdict_attempt_1', JSON.stringify(verification, null, 2));
    activeLedger.event(
      'warn',
      `Verifier requested one repair pass: ${verification.summary}`,
      'verifier-1',
      TASK_ID,
      'quality_gate',
    );

    const repairAgentId = chaos ? 'recovery-1' : 'builder-1';
    activeLedger.markAgent(repairAgentId, 'busy', TASK_ID);
    let repairedReport = await runBuilder(
      research,
      `Verifier repair request: ${verification.summary}\n\nCurrent report:\n${report}`,
      'revise',
    );
    const repairedReportGuardrail = localInputCheck(repairedReport, 'output');
    guardrails.report = repairedReportGuardrail;
    repairedReport = applyGuardrailToText(repairedReport, repairedReportGuardrail);
    activeLedger.saveArtifact(TASK_ID, 'planner-1', 'guardrail_decision', serializeGuardrails(guardrails));
    activeLedger.event(
      repairedReportGuardrail.decision === 'block' ? 'warn' : 'info',
      `Repaired report guardrail decision: ${repairedReportGuardrail.decision}`,
      'planner-1',
      TASK_ID,
      'guardrail',
    );
    if (repairedReportGuardrail.decision === 'block') {
      activeLedger.saveArtifact(TASK_ID, 'guardrail-1', 'blocked_report', repairedReport);
      activeLedger.degrade(TASK_ID, 'repaired report guardrail blocked the output');
      artifacts.report = repairedReport;
      artifacts.guardrail = serializeGuardrails(guardrails);
      return {
        runId,
        topic: guardedTopic,
        status: 'degraded',
        artifacts,
        ledger: activeLedger.snapshot(),
      };
    }
    report = repairedReport;
    activeLedger.saveArtifact(TASK_ID, repairAgentId, 'report', report);
    activeLedger.markAgent(repairAgentId, 'healthy');
    activeLedger.event('success', 'Repair pass complete. Re-running verifier.', repairAgentId, TASK_ID, 'quality_gate');
    verification = await runVerifier(report);
  }
  let verdict = JSON.stringify(verification, null, 2);
  const verdictGuardrail = localInputCheck(verdict, 'output');
  guardrails.verdict = verdictGuardrail;
  verdict = applyGuardrailToText(verdict, verdictGuardrail);
  activeLedger.saveArtifact(TASK_ID, 'planner-1', 'guardrail_decision', serializeGuardrails(guardrails));
  activeLedger.saveArtifact(TASK_ID, 'verifier-1', 'verdict', verdict);
  activeLedger.markAgent('verifier-1', 'healthy');
  activeLedger.event(
    verification.overall_pass ? 'success' : 'warn',
    `Verification rubric: completeness=${verification.completeness}, coherence=${verification.coherence}, usefulness=${verification.usefulness}, pass=${verification.overall_pass}`,
    'verifier-1',
    TASK_ID,
    'quality_gate',
  );
  artifacts.verdict = verdict;
  artifacts.guardrail = serializeGuardrails(guardrails);

  if (verdictGuardrail.decision === 'block') {
    activeLedger.degrade(TASK_ID, 'verdict guardrail blocked the quality decision');
    return {
      runId,
      topic: guardedTopic,
      status: 'degraded',
      artifacts,
      ledger: activeLedger.snapshot(),
    };
  }

  if (verification.overall_pass) {
    activeLedger.complete(TASK_ID, chaos ? 'recovered and verified through shared ledger' : 'completed and verified');
  } else {
    activeLedger.degrade(TASK_ID, `quality gate failed: ${verification.summary}`);
  }

  return {
    runId,
    topic: guardedTopic,
    status: verification.overall_pass ? (chaos ? 'recovered' : 'completed') : 'degraded',
    artifacts,
    ledger: activeLedger.snapshot(),
  };
}

export async function runRecoveryDemo(
  topic: string,
  failureKind: FailureKind = 'lost_agent',
  opts: { forceSimulation?: boolean } = { forceSimulation: true },
): Promise<RunResult> {
  const previousForce = process.env.AGORA_FORCE_SIMULATION;
  if (opts.forceSimulation !== false) process.env.AGORA_FORCE_SIMULATION = '1';
  try {
    setPendingChaos(failureKind);
    return await runAgentTask(topic);
  } finally {
    if (previousForce === undefined) {
      delete process.env.AGORA_FORCE_SIMULATION;
    } else {
      process.env.AGORA_FORCE_SIMULATION = previousForce;
    }
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCriticLoop(input: {
  topic: string;
  research: string;
  report: string;
  currentOwnerId: 'builder-1' | 'recovery-1';
  guardrails: {
    input: GuardrailReport;
    tool?: GuardrailReport;
    report?: GuardrailReport;
    critic?: GuardrailReport;
    verdict?: GuardrailReport;
  };
}): Promise<
  | { status: 'ok'; report: string; feedback: CriticFeedback[] }
  | { status: 'degraded'; report: string; feedback: CriticFeedback[] }
> {
  let report = input.report;
  const feedbackHistory: CriticFeedback[] = [];

  for (let round = 1; round <= 2; round += 1) {
    activeLedger.markAgent('critic-1', 'busy', TASK_ID);
    activeLedger.event('info', `Critic reviewing report round ${round}`, 'critic-1', TASK_ID, 'critic_loop');
    const feedback = await runCritic(input.topic, input.research, report);
    feedbackHistory.push(feedback);
    const feedbackJson = JSON.stringify(feedback, null, 2);
    const criticGuardrail = localInputCheck(feedbackJson, 'output');
    input.guardrails.critic = criticGuardrail;
    activeLedger.saveArtifact(TASK_ID, 'critic-1', `critic_round_${round}`, applyGuardrailToText(feedbackJson, criticGuardrail));
    activeLedger.saveArtifact(TASK_ID, 'planner-1', 'guardrail_decision', serializeGuardrails(input.guardrails));
    activeLedger.markAgent('critic-1', 'healthy');

    if (criticGuardrail.decision === 'block') {
      activeLedger.degrade(TASK_ID, 'critic guardrail blocked the review output');
      return { status: 'degraded', report, feedback: feedbackHistory };
    }

    if (feedback.severity === 'none') {
      activeLedger.event('success', `Critic round ${round}: no material issues`, 'critic-1', TASK_ID, 'critic_loop');
      return { status: 'ok', report, feedback: feedbackHistory };
    }

    activeLedger.event(
      feedback.severity === 'major' ? 'warn' : 'info',
      `Critic round ${round}: ${feedback.issues.length} ${feedback.severity} issue(s), requesting builder revision`,
      'critic-1',
      TASK_ID,
      'critic_loop',
    );

    activeLedger.markAgent(input.currentOwnerId, 'busy', TASK_ID);
    let revisedReport = await runBuilder(
      input.research,
      `Critic round ${round} feedback:\n${feedback.revised_guidance}\n\nIssues:\n${feedback.issues.map(issue => `- ${issue}`).join('\n')}\n\nCurrent report:\n${report}`,
      'revise',
    );
    const reportGuardrail = localInputCheck(revisedReport, 'output');
    input.guardrails.report = reportGuardrail;
    revisedReport = applyGuardrailToText(revisedReport, reportGuardrail);
    activeLedger.saveArtifact(TASK_ID, 'planner-1', 'guardrail_decision', serializeGuardrails(input.guardrails));
    activeLedger.event(
      reportGuardrail.decision === 'block' ? 'warn' : 'info',
      `Critic revision report guardrail decision: ${reportGuardrail.decision}`,
      'planner-1',
      TASK_ID,
      'guardrail',
    );
    if (reportGuardrail.decision === 'block') {
      activeLedger.saveArtifact(TASK_ID, 'guardrail-1', 'blocked_report', revisedReport);
      activeLedger.degrade(TASK_ID, 'critic-requested revision was blocked by guardrails');
      return { status: 'degraded', report: revisedReport, feedback: feedbackHistory };
    }

    report = revisedReport;
    activeLedger.saveArtifact(TASK_ID, input.currentOwnerId, `report_after_critic_round_${round}`, report);
    activeLedger.markAgent(input.currentOwnerId, 'healthy');
    activeLedger.event('success', `Builder revision after Critic round ${round} complete`, input.currentOwnerId, TASK_ID, 'critic_loop');
  }

  activeLedger.event('warn', 'Critic loop reached max 2 rounds; sending latest report to verifier', 'critic-1', TASK_ID, 'critic_loop');
  return { status: 'ok', report, feedback: feedbackHistory };
}

function applyGuardrailToText(text: string, report: GuardrailReport): string {
  if (report.decision === 'redact') return applyRedactions(text, report);
  return text;
}

function serializeGuardrails(reports: {
  input: GuardrailReport;
  tool?: GuardrailReport;
  report?: GuardrailReport;
  critic?: GuardrailReport;
  verdict?: GuardrailReport;
}): string {
  const finalDecision = [reports.input, reports.tool, reports.report, reports.critic, reports.verdict]
    .filter((report): report is GuardrailReport => Boolean(report))
    .map(report => report.decision)
    .includes('block')
    ? 'block'
    : [reports.input, reports.tool, reports.report, reports.critic, reports.verdict]
          .filter((report): report is GuardrailReport => Boolean(report))
          .map(report => report.decision)
          .includes('redact')
      ? 'redact'
      : 'allow';
  return JSON.stringify({ final_decision: finalDecision, ...reports }, null, 2);
}

function gatewayEvidence(fallbackTriggered: boolean): GatewayEvidence {
  const live = !shouldUseSimulation();
  return {
    gateway_mode: live ? 'live' : 'simulation',
    model_used: live
      ? process.env.TRUEFOUNDRY_VIRTUAL_MODEL?.trim() || 'aegis-resilient/claude-with-fallback'
      : 'simulation-mock',
    fallback_triggered: fallbackTriggered,
  };
}
