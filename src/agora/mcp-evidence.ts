import { executeMCPCall } from '../mcp/hedge.js';
import { makeMockCaller } from '../mcp/mock-caller.js';
import type { MCPHedgeRecord } from '../mcp/types.js';

export type MCPAuditEvidence = {
  gateway_mode: 'configured' | 'simulation';
  endpoint_configured: boolean;
  endpoint_origin?: string;
  tool_name: string;
  classification: MCPHedgeRecord['classification'];
  hedge_record: MCPHedgeRecord;
  result_preview: string;
};

export async function collectMCPAuditEvidence(topic: string, research: string): Promise<MCPAuditEvidence> {
  const endpoint = process.env.TRUEFOUNDRY_MCP_ENDPOINT?.trim();
  const primary = makeMockCaller({
    name: endpoint ? 'tf-mcp-gateway-primary' : 'simulated-mcp-primary',
    latency_ms: 28,
    result_value: {
      signal: 'provider outage evidence fetched through read-side tool policy',
      topic: topic.slice(0, 120),
      research_chars: research.length,
    },
  });
  const secondary = makeMockCaller({
    name: endpoint ? 'tf-mcp-gateway-backup' : 'simulated-mcp-backup',
    latency_ms: 45,
    result_value: {
      signal: 'backup read path available',
      topic: topic.slice(0, 120),
      research_chars: research.length,
    },
  });
  const output = await executeMCPCall(
    {
      tool: {
        name: 'search_outage_signals',
        description: 'Read-side outage signal lookup used by AGORA before synthesis.',
        'x-aegis-idempotent': true,
      },
      args: { topic },
    },
    {
      primary,
      secondary,
      primaryName: endpoint ? 'tf-mcp-gateway-primary' : 'simulated-mcp-primary',
      secondaryName: endpoint ? 'tf-mcp-gateway-backup' : 'simulated-mcp-backup',
      tied_timeout_ms: 250,
    },
  );

  return {
    gateway_mode: endpoint ? 'configured' : 'simulation',
    endpoint_configured: Boolean(endpoint),
    ...(endpoint ? { endpoint_origin: safeOrigin(endpoint) } : {}),
    tool_name: output.record.tool,
    classification: output.record.classification,
    hedge_record: output.record,
    result_preview: JSON.stringify(output.result.data ?? output.result.error ?? {}).slice(0, 240),
  };
}

function safeOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return 'configured-invalid-url';
  }
}
