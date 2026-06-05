import { describe, expect, test } from 'bun:test';
import { collectMCPAuditEvidence } from './mcp-evidence.js';

describe('AGORA MCP evidence', () => {
  test('records read-side MCP tool classification and hedge evidence', async () => {
    const previousEndpoint = process.env.TRUEFOUNDRY_MCP_ENDPOINT;
    delete process.env.TRUEFOUNDRY_MCP_ENDPOINT;

    try {
      const evidence = await collectMCPAuditEvidence('provider outage', 'research artifact');

      expect(evidence.gateway_mode).toBe('simulation');
      expect(evidence.endpoint_configured).toBe(false);
      expect(evidence.tool_name).toBe('search_outage_signals');
      expect(evidence.classification.klass).toBe('READ_HEDGE');
      expect(evidence.hedge_record.servers_raced).toEqual([
        'simulated-mcp-primary',
        'simulated-mcp-backup',
      ]);
      expect(evidence.hedge_record.outcome).toBe('success');
    } finally {
      if (previousEndpoint === undefined) {
        delete process.env.TRUEFOUNDRY_MCP_ENDPOINT;
      } else {
        process.env.TRUEFOUNDRY_MCP_ENDPOINT = previousEndpoint;
      }
    }
  });
});
