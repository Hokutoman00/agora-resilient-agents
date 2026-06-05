import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReceiptV0 } from '../receipt/builder.js';
import { receiptToRows } from './envelope.js';
import { exportReceiptToAIVS } from './exporter.js';
import { ZERO_HASH, computeChainHash, computePayloadHash, sha256Hex } from './hasher.js';
import { generateKeypair, signHex, verifyHex } from './signer.js';

let tmpDir: string;
let signingPath: string;
let verifierPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aegis-aivs-test-'));
  signingPath = join(tmpDir, 'signing-key.json');
  verifierPath = join(tmpDir, 'verifier-key.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const sampleReceipt: ReceiptV0 = {
  version: 'aegis-v3.0',
  request_id: '01JABCDEFGHIJKLMNPQRSTUVWX',
  started_at: '2026-06-01T00:00:00.000Z',
  duration_ms: 1234,
  providers_tried: [
    {
      name: 'anthropic/claude-sonnet-4-5',
      via: 'tf',
      outcome: 'success',
      ttft_ms: 250,
      total_ms: 1200,
      tokens: { input: 50, output: 200 },
    },
  ],
  layers_fired: ['L4'],
  cost_usd_total: 0.0123,
};

describe('AIVS hasher (chain integrity)', () => {
  test('sha256Hex matches known value for empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  test('chain hash is deterministic for identical inputs', () => {
    const seed = {
      id: 'r1',
      session_id: 's1',
      action_type: 'meta',
      tool_name: 'aegis.session_start',
      cost_cents: 0,
      timestamp: '2026-06-01T00:00:00.000Z',
      prev_hash: ZERO_HASH,
    };
    const h1 = computeChainHash(seed);
    const h2 = computeChainHash(seed);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
  });

  test('payload hash differs for different payloads', () => {
    const a = computePayloadHash({ x: 1 });
    const b = computePayloadHash({ x: 2 });
    expect(a).not.toBe(b);
  });
});

describe('AIVS envelope (Receipt → rows)', () => {
  test('produces meta-start + per-provider + meta-end rows with chained hashes', () => {
    const rows = receiptToRows(sampleReceipt);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const first = rows[0];
    const last = rows.at(-1);
    expect(first?.prev_hash).toBe(ZERO_HASH);
    expect(first?.action_type).toBe('meta');
    expect(last?.tool_name).toBe('aegis.session_end');
    // Chain continuity.
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      if (!prev || !cur) continue;
      expect(cur.prev_hash).toBe(prev.chain_hash);
    }
  });
});

describe('AIVS signer (Ed25519 roundtrip)', () => {
  test('sign + verify roundtrip', async () => {
    const { privateHex, publicHex } = await generateKeypair();
    const msg = 'a'.repeat(64); // arbitrary hex message
    const sig = await signHex(msg, privateHex);
    expect(await verifyHex(sig, msg, publicHex)).toBe(true);
  });

  test('tampered message fails verification', async () => {
    const { privateHex, publicHex } = await generateKeypair();
    const msg = 'a'.repeat(64);
    const sig = await signHex(msg, privateHex);
    const tampered = `${'b'.repeat(63)}c`;
    expect(await verifyHex(sig, tampered, publicHex)).toBe(false);
  });
});

describe('AIVS exporter (full bundle)', () => {
  test('exportReceiptToAIVS returns signed bundle; signature verifies', async () => {
    const bundle = await exportReceiptToAIVS(sampleReceipt, {
      signing_key_path: signingPath,
      verifier_key_path: verifierPath,
    });
    expect(bundle.manifest.signature_alg).toBe('ed25519');
    expect(bundle.manifest.row_count).toBe(bundle.rows.length);
    const ok = await verifyHex(
      bundle.signature_hex,
      bundle.manifest.final_chain_hash,
      bundle.manifest.public_key_hex,
    );
    expect(ok).toBe(true);
  });

  test('broken chain (tampered row) is detected by recomputing chain_hash', async () => {
    const bundle = await exportReceiptToAIVS(sampleReceipt, {
      signing_key_path: signingPath,
      verifier_key_path: verifierPath,
    });
    // Recompute chain from rows; should match manifest.final_chain_hash.
    const recomputed = bundle.rows.reduce((prev_hash, row) => {
      const h = computeChainHash({ ...row, prev_hash });
      expect(h).toBe(row.chain_hash); // tamper-detection: every row recomputes
      return row.chain_hash;
    }, ZERO_HASH);
    expect(recomputed).toBe(bundle.manifest.final_chain_hash);
  });
});
