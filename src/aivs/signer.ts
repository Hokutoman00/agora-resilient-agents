// Ed25519 signer/verifier for AIVS bundles.
//
// Keys are loaded (or lazily generated) from .aegis/signing-key.json.
// The public key is mirrored to .aegis/verifier-key.json so judges can
// run examples/verify-receipt.ts without trusting the private key file.
//
// We sign the final chain_hash of the bundle (32 bytes), NOT the JSON,
// so signature verification is canonicalization-independent.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

// noble/ed25519 v3 exposes the SHA-512 hook via `hashes.sha512`.
// Wire it once at module load so signAsync/verifyAsync work without
// requiring callers to import @noble/hashes.
ed.hashes.sha512 = (msg: Uint8Array) => sha512(msg);

export interface SigningKeyFile {
  alg: 'ed25519';
  private_key_hex: string;
  public_key_hex: string;
  created_at: string;
}

export interface VerifierKeyFile {
  alg: 'ed25519';
  public_key_hex: string;
  created_at: string;
}

export const SIGNING_KEY_PATH = '.aegis/signing-key.json';
export const VERIFIER_KEY_PATH = '.aegis/verifier-key.json';

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function generateKeypair(): Promise<{ privateHex: string; publicHex: string }> {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { privateHex: bytesToHex(priv), publicHex: bytesToHex(pub) };
}

// Lazy: generate on first signing call, persist to disk so subsequent runs
// reuse the same key. Public key always written to verifier-key.json.
export async function loadOrCreateSigningKey(
  signingPath = SIGNING_KEY_PATH,
  verifierPath = VERIFIER_KEY_PATH,
): Promise<SigningKeyFile> {
  if (existsSync(signingPath)) {
    return JSON.parse(readFileSync(signingPath, 'utf8')) as SigningKeyFile;
  }
  const { privateHex, publicHex } = await generateKeypair();
  const now = new Date().toISOString();
  const signing: SigningKeyFile = {
    alg: 'ed25519',
    private_key_hex: privateHex,
    public_key_hex: publicHex,
    created_at: now,
  };
  ensureDir(signingPath);
  writeFileSync(signingPath, JSON.stringify(signing, null, 2));
  ensureDir(verifierPath);
  const verifier: VerifierKeyFile = {
    alg: 'ed25519',
    public_key_hex: publicHex,
    created_at: now,
  };
  writeFileSync(verifierPath, JSON.stringify(verifier, null, 2));
  return signing;
}

export async function signHex(messageHex: string, privateKeyHex: string): Promise<string> {
  const sig = await ed.signAsync(hexToBytes(messageHex), hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

export async function verifyHex(
  signatureHex: string,
  messageHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(
      hexToBytes(signatureHex),
      hexToBytes(messageHex),
      hexToBytes(publicKeyHex),
    );
  } catch {
    return false;
  }
}
