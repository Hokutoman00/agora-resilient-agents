import type { FailureKind, HandoffReceipt, TaskRecord } from './types.js';

export function buildHandoffReceipt(input: {
  failedAgentId: string;
  takeoverAgentId: string;
  task: TaskRecord;
  failureKind: FailureKind;
  evidenceSeen: string[];
  recoveryStatus?: HandoffReceipt['recoveryStatus'];
}): HandoffReceipt {
  return {
    id: `agora-handoff-${Date.now()}`,
    failedAgentId: input.failedAgentId,
    takeoverAgentId: input.takeoverAgentId,
    taskId: input.task.id,
    failureKind: input.failureKind,
    evidenceSeen: [...new Set([...input.task.evidence, ...input.evidenceSeen])],
    completedParts: input.task.completedParts,
    failedParts: [...new Set([...input.task.failedParts, input.failureKind])],
    recoveryStatus: input.recoveryStatus ?? 'reassigned',
    createdAt: new Date().toISOString(),
  };
}
