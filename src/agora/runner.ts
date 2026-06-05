import { applyRedactions, localInputCheck, type GuardrailReport } from '../aegis/guardrails.js';
import { buildHandoffReceipt } from './handoff-receipt.js';
import { TaskLedger } from './ledger.js';
import { runBuilder } from './agents/builder.js';
import { runResearcher } from './agents/researcher.js';
import { runVerifier } from './agents/verifier.js';
import type { FailureKind, GatewayEvidence } from './types.js';

const TASK_ID = 'task-agora-demo';

export type RunResult = {
  runId: string;
  topic: string;
  status: 'completed' | 'failed' | 'recovered' | 'degraded';
  artifacts: { research?: string; report?: string; verdict?: string; guardrail?: string };
  ledger: ReturnType<TaskLedger['snapshot']>;
};

export const activeLedger = new TaskLedger();

let pendingChaos: FailureKind | null = null;

export function setPendingChaos(kind: FailureKind): void {
  pendingChaos = kind;
}

export async function runAgentTask(topic: string): Promise<RunResult> {
  const runId = `run-${Date.now()}`;
  const artifacts: RunResult['artifacts'] = {};
  const gateway = gatewayEvidence(false);
  const inputGuardrail = localInputCheck(topic, 'input');
  const guardedTopic = applyGuardrailToText(topic, inputGuardrail);
  const guardrails = { input: inputGuardrail } as {
    input: GuardrailReport;
    report?: GuardrailReport;
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

  activeLedger.markAgent('builder-1', 'busy', TASK_ID);
  activeLedger.event('info', 'Builder synthesizing report', 'builder-1', TASK_ID);

  const chaos = pendingChaos;
  pendingChaos = null;

  let report: string;
  if (chaos) {
    activeLedger.event('warn', `Chaos injected: ${chaos} on builder-1`, 'recovery-1', TASK_ID, 'watchdog');
    activeLedger.markAgent('builder-1', 'failed', TASK_ID);

    const task = activeLedger.snapshot().tasks.find(t => t.id === TASK_ID);
    if (!task) throw new Error(`unknown task: ${TASK_ID}`);

    const receipt = buildHandoffReceipt({
      failedAgentId: 'builder-1',
      takeoverAgentId: 'recovery-1',
      task,
      failureKind: chaos,
      gateway: gatewayEvidence(true),
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

  activeLedger.markAgent('verifier-1', 'busy', TASK_ID);
  const verification = await runVerifier(report);
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

function applyGuardrailToText(text: string, report: GuardrailReport): string {
  if (report.decision === 'redact') return applyRedactions(text, report);
  return text;
}

function serializeGuardrails(reports: {
  input: GuardrailReport;
  report?: GuardrailReport;
  verdict?: GuardrailReport;
}): string {
  const finalDecision = [reports.input, reports.report, reports.verdict]
    .filter((report): report is GuardrailReport => Boolean(report))
    .map(report => report.decision)
    .includes('block')
    ? 'block'
    : [reports.input, reports.report, reports.verdict]
          .filter((report): report is GuardrailReport => Boolean(report))
          .map(report => report.decision)
          .includes('redact')
      ? 'redact'
      : 'allow';
  return JSON.stringify({ final_decision: finalDecision, ...reports }, null, 2);
}

function gatewayEvidence(fallbackTriggered: boolean): GatewayEvidence {
  const live = Boolean(process.env.TRUEFOUNDRY_API_KEY?.trim());
  return {
    gateway_mode: live ? 'live' : 'simulation',
    model_used: live
      ? process.env.TRUEFOUNDRY_VIRTUAL_MODEL?.trim() || 'aegis-resilient/claude-with-fallback'
      : 'simulation-mock',
    fallback_triggered: fallbackTriggered,
  };
}
