import { describe, expect, test } from 'bun:test';
import { buildJudgePacket } from './judge-packet.js';
import { runRecoveryDemo } from './runner.js';
import type { AgoraState } from './types.js';

describe('AGORA judge packet', () => {
  test('starts as needs_run before judge-visible evidence exists', () => {
    const state: AgoraState = {
      agents: [],
      tasks: [],
      events: [],
      receipts: [],
    };

    const packet = buildJudgePacket(state, 'simulation', '2026-06-05T00:00:00.000Z');

    expect(packet.readiness_label).toBe('needs_run');
    expect(packet.readiness_score).toBe(0);
    expect(packet.criteria.every(criterion => !criterion.passed)).toBe(true);
  });

  test('recovery demo creates a complete judge packet', async () => {
    const previousKey = process.env.TRUEFOUNDRY_API_KEY;
    process.env.TRUEFOUNDRY_API_KEY = '';

    try {
      const result = await runRecoveryDemo(
        'The primary AI model provider is unavailable. Produce customer-facing recovery evidence.',
        'lost_agent',
      );
      const packet = buildJudgePacket(result.ledger, 'simulation', '2026-06-05T00:00:00.000Z');

      expect(result.status).toBe('recovered');
      expect(result.ledger.receipts.at(-1)?.failureKind).toBe('lost_agent');
      expect(packet.readiness_label).toBe('demo_ready');
      expect(packet.readiness_score).toBe(100);
      expect(packet.criteria.every(criterion => criterion.passed)).toBe(true);
      expect(packet.artifact_keys).toContain('planner-1:mcp_tool_audit');
      expect(packet.artifact_keys).toContain('verifier-1:verdict');
    } finally {
      if (previousKey === undefined) {
        delete process.env.TRUEFOUNDRY_API_KEY;
      } else {
        process.env.TRUEFOUNDRY_API_KEY = previousKey;
      }
    }
  });
});
