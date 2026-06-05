import { describe, expect, test } from 'bun:test';
import { TaskLedger } from './ledger.js';
import { injectFailureAndRecover } from './watchdog.js';

describe('AGORA watchdog recovery', () => {
  test('creates a handoff receipt and completes the task after agent loss', () => {
    const ledger = new TaskLedger();
    const receipt = injectFailureAndRecover(ledger, { failureKind: 'lost_agent' });
    const state = ledger.snapshot();

    expect(receipt.failedAgentId).toBe('builder-1');
    expect(receipt.takeoverAgentId).toBe('recovery-1');
    expect(receipt.evidenceSeen).toContain('shared ledger retained task decomposition and partial output');

    const task = state.tasks.find(t => t.id === 'task-agora-demo');
    expect(task?.status).toBe('completed');
    expect(task?.assignedAgentId).toBe('recovery-1');
    expect(task?.failedParts).toContain('lost_agent');
    expect(state.receipts).toHaveLength(1);
  });
});
