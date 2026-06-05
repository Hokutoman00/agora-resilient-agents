import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { quarantineMCPCall } from './transport-quarantine.js';

let tmpDir: string;
let pinStorePath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'aegis-mcp-pin-test-'));
  pinStorePath = join(tmpDir, 'mcp-pins.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP transport quarantine (C4, CVSS 9.8 April 2026)', () => {
  test('STDIO without aegis_stdio_acknowledged → refused', () => {
    const d = quarantineMCPCall({ transport: 'stdio' });
    expect(d.allowed).toBe(false);
    expect(d.record.quarantine_decision).toBe('refused');
    expect(d.record.quarantine_reason).toContain('stdio');
  });

  test('STDIO with explicit acknowledgment → allowed, Receipt records', () => {
    const d = quarantineMCPCall({
      transport: 'stdio',
      aegis_stdio_acknowledged: true,
    });
    expect(d.allowed).toBe(true);
    expect(d.record.quarantine_decision).toBe('allowed');
    expect(d.record.quarantine_reason).toBe('stdio_acknowledged');
  });

  test('HTTP first use → TOFU pin recorded, allowed', () => {
    const d = quarantineMCPCall({
      transport: 'streamable_http',
      origin: 'https://mcp.example.com',
      presented_fingerprint: 'sha256:abcd1234',
      pin_store_path: pinStorePath,
    });
    expect(d.allowed).toBe(true);
    expect(d.record.pin_status).toBe('first_use');
    expect(d.record.quarantine_reason).toBe('tofu_first_use');
  });

  test('HTTP mismatch on subsequent call → refused', () => {
    // Seed pin.
    quarantineMCPCall({
      transport: 'streamable_http',
      origin: 'https://mcp.example.com',
      presented_fingerprint: 'sha256:original',
      pin_store_path: pinStorePath,
    });
    // Same origin, different fingerprint → mismatch.
    const d = quarantineMCPCall({
      transport: 'streamable_http',
      origin: 'https://mcp.example.com',
      presented_fingerprint: 'sha256:tampered',
      pin_store_path: pinStorePath,
    });
    expect(d.allowed).toBe(false);
    expect(d.record.pin_status).toBe('mismatch_refused');
    expect(d.record.quarantine_decision).toBe('refused');
  });
});
