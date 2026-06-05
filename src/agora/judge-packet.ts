import type { AgoraState, EventRecord, FailureKind, HandoffReceipt, TaskRecord } from './types.js';

export type JudgeCriterion = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type JudgePacket = {
  generated_at: string;
  gateway_mode: 'live' | 'simulation';
  readiness_score: number;
  readiness_label: 'demo_ready' | 'evidence_partial' | 'needs_run';
  summary: string;
  criteria: JudgeCriterion[];
  latest_task: TaskRecord | null;
  latest_receipt: HandoffReceipt | null;
  artifact_keys: string[];
  timeline_tail: EventRecord[];
};

export function buildJudgePacket(
  state: AgoraState,
  gatewayMode: JudgePacket['gateway_mode'],
  generatedAt = new Date().toISOString(),
): JudgePacket {
  const task = state.tasks[0] ?? null;
  const receipt = state.receipts.at(-1) ?? null;
  const artifactKeys = Object.keys(task?.artifacts ?? {});
  const criteria = judgeCriteria(state);
  const passed = criteria.filter(criterion => criterion.passed).length;
  const readinessScore = Math.round((passed / criteria.length) * 100);
  const readinessLabel =
    readinessScore === 100 ? 'demo_ready' : readinessScore >= 60 ? 'evidence_partial' : 'needs_run';

  return {
    generated_at: generatedAt,
    gateway_mode: gatewayMode,
    readiness_score: readinessScore,
    readiness_label: readinessLabel,
    summary: summaryFor(readinessLabel, receipt?.failureKind),
    criteria,
    latest_task: task,
    latest_receipt: receipt,
    artifact_keys: artifactKeys,
    timeline_tail: state.events.slice(-12),
  };
}

export function judgeCriteria(state: AgoraState): JudgeCriterion[] {
  const task = state.tasks[0];
  const artifacts = task?.artifacts ?? {};
  const artifactValues = Object.values(artifacts);
  const hasArtifact = (suffix: string): boolean => Object.keys(artifacts).some(key => key.endsWith(suffix));
  const hasKeyIncluding = (needle: string): boolean => Object.keys(artifacts).some(key => key.includes(needle));
  const hasValueIncluding = (needle: string): boolean => artifactValues.some(value => value.includes(needle));
  const latestReceipt = state.receipts.at(-1);

  return [
    {
      id: 'tf_gateway',
      label: 'TF Gateway evidence',
      passed: state.events.some(event => event.type === 'gateway'),
      detail: 'Gateway mode, model, and fallback evidence are recorded in the ledger.',
    },
    {
      id: 'mcp_tool_policy',
      label: 'MCP tool policy',
      passed: hasArtifact('mcp_tool_audit') && hasValueIncluding('READ_HEDGE'),
      detail: 'Read-side MCP calls are classified and hedged instead of treated as opaque tools.',
    },
    {
      id: 'guardrails',
      label: 'Guardrails',
      passed: hasArtifact('guardrail_decision'),
      detail: 'Input, tool, report, critic, and verifier guardrail decisions are preserved.',
    },
    {
      id: 'failure_recovery',
      label: 'Failure recovery',
      passed: Boolean(latestReceipt) && task?.status === 'completed',
      detail: 'A failed worker has a handoff receipt and the user deliverable still completes.',
    },
    {
      id: 'critic_revision',
      label: 'Critic revision loop',
      passed: hasKeyIncluding(':critic_round') && hasKeyIncluding('report_after_critic_round'),
      detail: 'Critic feedback and Builder revision are both saved as judge-visible artifacts.',
    },
    {
      id: 'verifier_gate',
      label: 'Verifier quality gate',
      passed: hasArtifact('verdict') && task?.status === 'completed',
      detail: 'The final answer is not marked complete until the rubric verdict is recorded.',
    },
  ];
}

function summaryFor(readinessLabel: JudgePacket['readiness_label'], failureKind?: FailureKind): string {
  if (readinessLabel === 'demo_ready') {
    return `AGORA is demo-ready: ${failureKind ?? 'agent'} failure was injected, recovered, critiqued, and verifier-gated.`;
  }
  if (readinessLabel === 'evidence_partial') {
    return 'AGORA has partial evidence; run the Judge Demo to produce a complete recovery packet.';
  }
  return 'AGORA needs a run before a judge can inspect recovery evidence.';
}
