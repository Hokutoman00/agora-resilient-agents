// Aegis Receipt → AIVS RowV1 envelope conversion.
//
// One Receipt produces multiple AIVS rows (one per ProviderTry,
// one per guardrail-assessment, one per MCP call, plus meta rows).
// Rows are chain-hashed in append order; the bundle is signed once.

import { ulid } from 'ulid';
import type { ReceiptV0 } from '../receipt/builder.js';
import { ZERO_HASH, computeChainHash, computePayloadHash } from './hasher.js';
import type { AIVSRowV1 } from './types.js';

export interface EnvelopeOptions {
  session_id?: string;
  agent_id?: string;
}

interface PartialRow {
  action_type: string;
  tool_name: string;
  cost_cents: number;
  payload: Record<string, unknown>;
}

// USD → 1/100 cent integer. 1 USD = 10000 (hundredths of a cent).
function usdToHundredthCents(usd: number): number {
  return Math.round(usd * 10000);
}

export function receiptToRows(receipt: ReceiptV0, opts: EnvelopeOptions = {}): AIVSRowV1[] {
  const session_id = opts.session_id ?? receipt.request_id;
  const partials: PartialRow[] = [];

  // Meta row — session start.
  partials.push({
    action_type: 'meta',
    tool_name: 'aegis.session_start',
    cost_cents: 0,
    payload: {
      request_id: receipt.request_id,
      version: receipt.version,
      started_at: receipt.started_at,
      layers_fired: receipt.layers_fired,
    },
  });

  // One row per ProviderTry.
  for (const p of receipt.providers_tried) {
    partials.push({
      action_type: 'llm_call',
      tool_name: p.name,
      cost_cents: 0, // per-call cost not separately tracked; aggregated below
      payload: {
        via: p.via,
        outcome: p.outcome,
        ttft_ms: p.ttft_ms,
        total_ms: p.total_ms,
        error: p.error ?? null,
        tokens: p.tokens ?? null,
      },
    });
  }

  // L4 semantic fallback (if fired).
  if (receipt.l4_semantic) {
    partials.push({
      action_type: 'fallback',
      tool_name: `l4.${receipt.l4_semantic.rule_id}`,
      cost_cents: 0,
      payload: receipt.l4_semantic as unknown as Record<string, unknown>,
    });
  }

  // L0 hedge (if fired).
  if (receipt.l0_hedge?.fired) {
    partials.push({
      action_type: 'fallback',
      tool_name: 'l0.hedge',
      cost_cents: usdToHundredthCents(receipt.l0_hedge.extra_cost_usd),
      payload: receipt.l0_hedge as unknown as Record<string, unknown>,
    });
  }

  // L5 contract record.
  if (receipt.l5_contract) {
    partials.push({
      action_type: 'meta',
      tool_name: 'l5.contract',
      cost_cents: 0,
      payload: receipt.l5_contract as unknown as Record<string, unknown>,
    });
  }

  // Final meta row — session end + total cost.
  partials.push({
    action_type: 'meta',
    tool_name: 'aegis.session_end',
    cost_cents: usdToHundredthCents(receipt.cost_usd_total),
    payload: {
      duration_ms: receipt.duration_ms,
      layers_fired: receipt.layers_fired,
      cost_usd_total: receipt.cost_usd_total,
      tf_health: receipt.tf_health ?? null,
    },
  });

  // Hash-chain the rows in order.
  const baseTime = receipt.started_at;
  const rows: AIVSRowV1[] = [];
  let prev_hash = ZERO_HASH;
  for (let i = 0; i < partials.length; i++) {
    const partial = partials[i];
    if (!partial) continue;
    const id = ulid();
    // Spread timestamps slightly so they're monotonic but stay within started_at second.
    const timestamp = new Date(Date.parse(baseTime) + i).toISOString();
    const payload_hash = computePayloadHash(partial.payload);
    const seed = {
      id,
      session_id,
      action_type: partial.action_type,
      tool_name: partial.tool_name,
      cost_cents: partial.cost_cents,
      timestamp,
      prev_hash,
    };
    const chain_hash = computeChainHash(seed);
    const row: AIVSRowV1 = {
      ...seed,
      payload: partial.payload,
      payload_hash,
      chain_hash,
      aivs_version: 'draft-stone-aivs-00',
    };
    rows.push(row);
    prev_hash = chain_hash;
  }
  return rows;
}

export function finalChainHash(rows: AIVSRowV1[]): string {
  const last = rows.at(-1);
  return last?.chain_hash ?? ZERO_HASH;
}
