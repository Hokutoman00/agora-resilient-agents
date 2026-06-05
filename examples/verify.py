#!/usr/bin/env python3
"""
Standalone AIVS bundle verifier (stdlib + cryptography only).

Usage:
    python3 verify.py <bundle-dir>

Bundle dir must contain:
    audit_log.jsonl   one AIVS RowV1 per line
    manifest.json     bundle metadata + public key
    session_sig.txt   hex Ed25519 signature over manifest.final_chain_hash

Exit codes:
    0  verification passed
    2  verification failed (chain break, hash mismatch, or signature invalid)
    3  missing dependency

Per AIVS draft-stone-aivs-00. Inline; no network access; no Aegis trust.
"""
import hashlib
import json
import os
import sys


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def chain_input(row: dict) -> str:
    return ":".join([
        row["id"],
        row["session_id"],
        row["action_type"],
        row["tool_name"],
        str(row["cost_cents"]),
        row["timestamp"],
        row["prev_hash"],
    ])


def main(bundle_dir: str) -> int:
    manifest_path = os.path.join(bundle_dir, "manifest.json")
    sig_path = os.path.join(bundle_dir, "session_sig.txt")
    log_path = os.path.join(bundle_dir, "audit_log.jsonl")

    with open(manifest_path) as f:
        manifest = json.load(f)
    with open(sig_path) as f:
        sig_hex = f.read().strip()
    with open(log_path) as f:
        rows = [json.loads(line) for line in f if line.strip()]

    print(f"Bundle:     {manifest['bundle_id']}")
    print(f"Rows:       {len(rows)} (manifest {manifest['row_count']})")

    # Chain check.
    prev_hash = "0" * 64
    for row in rows:
        if row["prev_hash"] != prev_hash:
            print(f"CHAIN BREAK at {row['id']}")
            return 2
        if sha256_hex(chain_input(row)) != row["chain_hash"]:
            print(f"TAMPER at {row['id']}")
            return 2
        prev_hash = row["chain_hash"]

    if prev_hash != manifest["final_chain_hash"]:
        print("FINAL CHAIN MISMATCH")
        return 2
    print("Chain:      OK")

    # Signature check (requires `cryptography`).
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from cryptography.exceptions import InvalidSignature
    except ImportError:
        print("MISSING DEP: pip install cryptography  # then re-run")
        return 3

    try:
        pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(manifest["public_key_hex"]))
        pub.verify(bytes.fromhex(sig_hex), bytes.fromhex(manifest["final_chain_hash"]))
        print("Signature:  OK (Ed25519)")
    except InvalidSignature:
        print("SIGNATURE INVALID")
        return 2

    print("\nVerification PASSED")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 verify.py <bundle-dir>")
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
