// SHA-256 hashing for AIVS chain + payload hashes.
//
// Canonical hash input format (per AIVS draft-stone-aivs-00):
//   "{id}:{session_id}:{action_type}:{tool_name}:{cost_cents}:{timestamp}:{prev_hash}"
//
// All hex outputs are lowercase. Zero hash (string of 64 '0') marks the
// first row in a session (no predecessor).

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { AIVSRowV1 } from './types.js';

export const ZERO_HASH = '0'.repeat(64);

export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return bytesToHex(sha256(bytes));
}

// Canonical chain input. ORDER MATTERS — must match verifier exactly.
export function chainInput(
  row: Pick<
    AIVSRowV1,
    'id' | 'session_id' | 'action_type' | 'tool_name' | 'cost_cents' | 'timestamp' | 'prev_hash'
  >,
): string {
  return [
    row.id,
    row.session_id,
    row.action_type,
    row.tool_name,
    String(row.cost_cents),
    row.timestamp,
    row.prev_hash,
  ].join(':');
}

export function computeChainHash(
  row: Pick<
    AIVSRowV1,
    'id' | 'session_id' | 'action_type' | 'tool_name' | 'cost_cents' | 'timestamp' | 'prev_hash'
  >,
): string {
  return sha256Hex(chainInput(row));
}

// Canonical JSON serialization for payload hashing: keys sorted lexicographically,
// no extra whitespace. Equivalent to a minimal subset of RFC 8785 JCS.
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function computePayloadHash(payload: Record<string, unknown>): string {
  return sha256Hex(canonicalJSON(payload));
}
