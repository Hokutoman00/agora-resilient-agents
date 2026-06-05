// Standalone AIVS bundle verifier for judges (Bun-runnable, zero trust in Aegis).
//
// Usage:
//   bun run examples/verify-receipt.ts <path-to-bundle-dir>
//
// Bundle dir must contain: audit_log.jsonl + manifest.json + session_sig.txt
// The public key is read from manifest.public_key_hex (NOT from a local file)
// so judges can verify a bundle they received over email, etc.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ZERO_HASH, computeChainHash } from '../src/aivs/hasher.js';
import { verifyHex } from '../src/aivs/signer.js';
import type { AIVSManifest, AIVSRowV1 } from '../src/aivs/types.js';

const bundleDir = process.argv[2];
if (!bundleDir) {
  console.error('Usage: bun run examples/verify-receipt.ts <bundle-dir>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(bundleDir, 'manifest.json'), 'utf8')) as AIVSManifest;
const sig = readFileSync(join(bundleDir, 'session_sig.txt'), 'utf8').trim();
const rows = readFileSync(join(bundleDir, 'audit_log.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as AIVSRowV1);

console.log(`Bundle:        ${manifest.bundle_id}`);
console.log(`Session:       ${manifest.session_id}`);
console.log(`Agent:         ${manifest.agent_id}`);
console.log(`Rows:          ${rows.length} (manifest says ${manifest.row_count})`);
console.log(`Algorithm:     ${manifest.signature_alg}`);
console.log(`Public key:    ${manifest.public_key_hex.slice(0, 16)}...`);

let chainOk = true;
let prev_hash = ZERO_HASH;
for (const row of rows) {
  if (row.prev_hash !== prev_hash) {
    console.error(`CHAIN BREAK at row ${row.id}: prev_hash mismatch`);
    chainOk = false;
    break;
  }
  const recomputed = computeChainHash({
    id: row.id,
    session_id: row.session_id,
    action_type: row.action_type,
    tool_name: row.tool_name,
    cost_cents: row.cost_cents,
    timestamp: row.timestamp,
    prev_hash: row.prev_hash,
  });
  if (recomputed !== row.chain_hash) {
    console.error(`TAMPER at row ${row.id}: chain_hash mismatch`);
    chainOk = false;
    break;
  }
  prev_hash = row.chain_hash;
}

if (chainOk) {
  console.log('Chain hash:    OK (every row chain_hash recomputes)');
}

const finalOk = prev_hash === manifest.final_chain_hash;
console.log(`Final hash:    ${finalOk ? 'OK' : 'FAIL'} (matches manifest)`);

const sigOk = await verifyHex(sig, manifest.final_chain_hash, manifest.public_key_hex);
console.log(`Signature:     ${sigOk ? 'OK' : 'FAIL'} (Ed25519)`);

const allOk = chainOk && finalOk && sigOk;
console.log(allOk ? '\nVerification PASSED' : '\nVerification FAILED');
process.exit(allOk ? 0 : 2);
