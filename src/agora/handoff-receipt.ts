import type { FailureKind, HandoffReceipt, TaskRecord } from './types.js';

export function buildHandoffReceipt(input: {
  failedAgentId: string;
  takeoverAgentId: string;
  task: TaskRecord;
  failureKind: FailureKind;
  evidenceSeen: string[];
  recoveryStatus?: HandoffReceipt['recoveryStatus'];
  gateway?: HandoffReceipt['gateway'];
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
    gateway: input.gateway,
    createdAt: new Date().toISOString(),
  };
}
