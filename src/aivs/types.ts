// AIVS (Agentic Integrity Verification Standard) types.
//
// Aegis Receipt → AIVS RowV1 (11 required fields) conversion.
// Reference: IETF draft-stone-aivs-00 (April 2026), W3C AIVS CG.
//
// Each row is the canonical serialization of one verifiable action.
// Rows are SHA-256 hash-chained (prev_hash + chain_hash) so any
// tampering of an earlier row breaks all later rows. The whole bundle
// is signed once with Ed25519 over the final chain_hash.

export interface AIVSRowV1 {
  // 1. ULID or UUID — unique row identifier.
  id: string;
  // 2. Session identifier (groups rows from one agent run).
  session_id: string;
  // 3. Action taxonomy: 'llm_call' | 'tool_call' | 'guardrail' | 'fallback' | 'mcp_call' | 'meta'.
  action_type: string;
  // 4. Provider or tool name (e.g. 'anthropic/claude-sonnet-4-5', 'mcp/get_weather').
  tool_name: string;
  // 5. Cost in 1/100 USD cents (integer; 0 if unknown).
  cost_cents: number;
  // 6. ISO 8601 timestamp (UTC, millisecond precision).
  timestamp: string;
  // 7. SHA-256 of the previous row's chain_hash (lowercase hex). Zero-string for first row.
  prev_hash: string;
  // 8. SHA-256 of canonical "{id}:{session_id}:{action_type}:{tool_name}:{cost_cents}:{timestamp}:{prev_hash}".
  chain_hash: string;
  // 9. Free-form JSON payload describing the action specifics (input/output excerpt, error class, etc).
  payload: Record<string, unknown>;
  // 10. SHA-256 of the canonical JSON serialization of `payload`.
  payload_hash: string;
  // 11. AIVS draft version identifier.
  aivs_version: 'draft-stone-aivs-00';
}

export interface AIVSManifest {
  version: 'draft-stone-aivs-00';
  bundle_id: string;
  session_id: string;
  agent_id: string;
  created_at: string;
  row_count: number;
  first_id: string;
  last_id: string;
  final_chain_hash: string;
  signature_alg: 'ed25519';
  public_key_hex: string;
}

export interface AIVSBundle {
  manifest: AIVSManifest;
  rows: AIVSRowV1[];
  signature_hex: string;
}
