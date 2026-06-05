import { buildHandoffReceipt } from './handoff-receipt.js';
import { TaskLedger } from './ledger.js';
import type { FailureKind, HandoffReceipt } from './types.js';

const RECOVERY_AGENT = 'recovery-1';

export function injectFailureAndRecover(
  ledger: TaskLedger,
  opts: {
    failedAgentId?: string;
    takeoverAgentId?: string;
    taskId?: string;
    failureKind?: FailureKind;
  } = {},
): HandoffReceipt {
  const snapshot = ledger.snapshot();
  const failedAgentId = opts.failedAgentId ?? 'builder-1';
  const takeoverAgentId = opts.takeoverAgentId ?? 'recovery-1';
  const taskId = opts.taskId ?? 'task-agora-demo';
  const failureKind = opts.failureKind ?? 'lost_agent';
  const task = snapshot.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`unknown task: ${taskId}`);

  ledger.event('warn', `watchdog detected ${failureKind} on ${failedAgentId}`, RECOVERY_AGENT, taskId, 'watchdog');
  ledger.markAgent(failedAgentId, 'failed', taskId);

  const receipt = buildHandoffReceipt({
    failedAgentId,
    takeoverAgentId,
    task,
    failureKind,
    evidenceSeen: [
      `watchdog observation: ${failedAgentId} stopped heartbeating`,
      'shared ledger retained task decomposition and partial output',
      'verifier required recovery proof before final answer',
    ],
  });

  ledger.applyReceipt(receipt);
  ledger.complete(taskId, 'recovered through shared ledger and handoff receipt');
  return receipt;
}
