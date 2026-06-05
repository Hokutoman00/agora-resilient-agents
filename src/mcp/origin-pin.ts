// MCP origin pin store (TOFU — trust-on-first-use).
//
// On the first call to a new MCP HTTP origin we record a fingerprint
// (host:port + advertised public key hash, or a synthetic id provided
// by the caller). Subsequent calls compare; mismatch refuses the call
// and emits a Receipt-recorded quarantine decision.
//
// Storage is a JSON file at ~/.aegis/mcp-pins.json. The store is
// process-local; concurrent writes are not coordinated (single-process
// assumption matches the rest of Aegis's runtime).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface PinEntry {
  origin: string;
  fingerprint: string;
  first_seen: string;
}

export type PinStore = Record<string, PinEntry>;

export function defaultPinStorePath(): string {
  return join(homedir(), '.aegis', 'mcp-pins.json');
}

export function loadPins(path: string = defaultPinStorePath()): PinStore {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PinStore;
  } catch {
    return {};
  }
}

export function savePins(store: PinStore, path: string = defaultPinStorePath()): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export type PinStatus = 'first_use' | 'matched' | 'mismatch_refused';

export interface PinCheck {
  status: PinStatus;
  stored_fingerprint?: string;
  presented_fingerprint: string;
}

export function checkPin(
  origin: string,
  presented_fingerprint: string,
  storePath: string = defaultPinStorePath(),
): PinCheck {
  const store = loadPins(storePath);
  const existing = store[origin];
  if (!existing) {
    store[origin] = {
      origin,
      fingerprint: presented_fingerprint,
      first_seen: new Date().toISOString(),
    };
    savePins(store, storePath);
    return { status: 'first_use', presented_fingerprint };
  }
  if (existing.fingerprint === presented_fingerprint) {
    return {
      status: 'matched',
      stored_fingerprint: existing.fingerprint,
      presented_fingerprint,
    };
  }
  return {
    status: 'mismatch_refused',
    stored_fingerprint: existing.fingerprint,
    presented_fingerprint,
  };
}
