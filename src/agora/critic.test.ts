import { describe, expect, test } from 'bun:test';
import { runAgentTask } from './runner.js';

describe('AGORA critic loop', () => {
  test('runs Critic feedback and Builder revision before final verification', async () => {
    const previousKey = process.env.TRUEFOUNDRY_API_KEY;
    process.env.TRUEFOUNDRY_API_KEY = '';

    try {
      const result = await runAgentTask(
        'The primary AI model provider is unavailable. Draft a customer communication plan with recovery evidence.',
      );
      const task = result.ledger.tasks[0];
      expect(task).toBeDefined();
      if (!task) throw new Error('expected AGORA task to exist');
      const artifactKeys = Object.keys(task.artifacts ?? {});
      const eventTypes = result.ledger.events.map(event => event.type);

      expect(result.status).toBe('completed');
      expect(eventTypes).toContain('critic_loop');
      expect(eventTypes).toContain('mcp_tool');
      expect(artifactKeys).toContain('planner-1:mcp_tool_audit');
      expect(artifactKeys).toContain('critic-1:critic_round_1');
      expect(artifactKeys).toContain('builder-1:report_after_critic_round_1');
      expect(result.artifacts.mcp).toContain('READ_HEDGE');
      expect(result.artifacts.critic).toContain('revised_guidance');
      expect(result.artifacts.report).toContain('Builder revised after peer critique');
    } finally {
      if (previousKey === undefined) {
        delete process.env.TRUEFOUNDRY_API_KEY;
      } else {
        process.env.TRUEFOUNDRY_API_KEY = previousKey;
      }
    }
  });
});
