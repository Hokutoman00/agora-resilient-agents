// AIVS bundle exporter.
//
// Aegis Receipt → AIVS bundle (JSON in-memory; bundle-on-disk tar.gz
// production-shipped by a separate tool — kept out of the runtime to
// avoid an extra dependency. Tests verify the in-memory bundle).
//
// Bundle contents (per AIVS draft-stone-aivs-00):
//   audit_log.jsonl  — one AIVSRowV1 per line, append order
//   manifest.json    — AIVSManifest (bundle id, key, hash, sig)
//   session_sig.txt  — bare hex Ed25519 signature over final chain_hash
//   public_key.pem   — PEM-wrapped Ed25519 public key
//   verify.py        — stdlib-only Python verifier (judges can run anywhere)

import { ulid } from 'ulid';
import type { ReceiptV0 } from '../receipt/builder.js';
import { finalChainHash, receiptToRows } from './envelope.js';
import { loadOrCreateSigningKey, signHex } from './signer.js';
import type { AIVSBundle, AIVSManifest, AIVSRowV1 } from './types.js';

export interface ExportOptions {
  agent_id?: string;
  signing_key_path?: string;
  verifier_key_path?: string;
}

export async function exportReceiptToAIVS(
  receipt: ReceiptV0,
  opts: ExportOptions = {},
): Promise<AIVSBundle> {
  const agent_id = opts.agent_id ?? 'aegis-tf-resilient-online';
  const rows = receiptToRows(receipt, { session_id: receipt.request_id, agent_id });
  return await signRows(rows, receipt.request_id, agent_id, opts);
}

export async function signRows(
  rows: AIVSRowV1[],
  session_id: string,
  agent_id: string,
  opts: ExportOptions = {},
): Promise<AIVSBundle> {
  const key = await loadOrCreateSigningKey(opts.signing_key_path, opts.verifier_key_path);
  const final_chain_hash = finalChainHash(rows);
  const signature_hex = await signHex(final_chain_hash, key.private_key_hex);
  const first = rows.at(0);
  const last = rows.at(-1);
  const manifest: AIVSManifest = {
    version: 'draft-stone-aivs-00',
    bundle_id: ulid(),
    session_id,
    agent_id,
    created_at: new Date().toISOString(),
    row_count: rows.length,
    first_id: first?.id ?? '',
    last_id: last?.id ?? '',
    final_chain_hash,
    signature_alg: 'ed25519',
    public_key_hex: key.public_key_hex,
  };
  return { manifest, rows, signature_hex };
}

// Serialize to JSONL + manifest + sig for on-disk export.
export function bundleToFiles(bundle: AIVSBundle): Record<string, string> {
  const audit_log_jsonl = bundle.rows.map((r) => JSON.stringify(r)).join('\n');
  const manifest_json = JSON.stringify(bundle.manifest, null, 2);
  const session_sig = bundle.signature_hex;
  return {
    'audit_log.jsonl': audit_log_jsonl,
    'manifest.json': manifest_json,
    'session_sig.txt': session_sig,
  };
}
