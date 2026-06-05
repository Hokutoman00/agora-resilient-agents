// MCP transport quarantine (C4).
//
// Background: April 2026 CVSS 9.8 in Anthropic MCP SDKs (Python/TS/Java/Rust)
// affecting STDIO transport. ~200K MCP servers exposed; sponsor Anthropic
// will weight any submission that explicitly addresses it.
//
// Aegis policy:
//   STDIO            → REFUSE unless caller explicitly acknowledges with
//                      `aegis_stdio_acknowledged: true`. Stronger than warn;
//                      forces operators to opt-in per environment.
//   streamable_http  → REQUIRE TOFU origin pin via origin-pin.ts.
//                      First call records; mismatch refuses.
//   sse              → REQUIRE TOFU origin pin (same as streamable_http).
//   unknown          → REFUSE (conservative).
//
// All decisions produce an MCPTransportRecord that flows into the Receipt
// so the audit trail proves quarantine was enforced.

import type { MCPTransportRecord } from '../receipt/builder.js';
import { checkPin, defaultPinStorePath } from './origin-pin.js';

export type MCPTransport = 'stdio' | 'streamable_http' | 'sse' | 'unknown';

export interface QuarantineOptions {
  transport: MCPTransport;
  origin?: string; // required for HTTP/SSE
  presented_fingerprint?: string; // required for HTTP/SSE
  aegis_stdio_acknowledged?: boolean; // required for stdio
  pin_store_path?: string;
}

export interface QuarantineDecision {
  allowed: boolean;
  record: MCPTransportRecord;
}

export function quarantineMCPCall(opts: QuarantineOptions): QuarantineDecision {
  const { transport } = opts;

  if (transport === 'stdio') {
    const acknowledged = opts.aegis_stdio_acknowledged === true;
    return {
      allowed: acknowledged,
      record: {
        transport: 'stdio',
        ...(opts.origin ? { origin: opts.origin } : {}),
        pin_status: 'na',
        quarantine_decision: acknowledged ? 'allowed' : 'refused',
        quarantine_reason: acknowledged
          ? 'stdio_acknowledged'
          : 'stdio_refused_cvss_9_8_april_2026',
      },
    };
  }

  if (transport === 'streamable_http' || transport === 'sse') {
    if (!opts.origin || !opts.presented_fingerprint) {
      return {
        allowed: false,
        record: {
          transport,
          ...(opts.origin ? { origin: opts.origin } : {}),
          pin_status: 'na',
          quarantine_decision: 'refused',
          quarantine_reason: 'missing_origin_or_fingerprint',
        },
      };
    }
    const pin = checkPin(
      opts.origin,
      opts.presented_fingerprint,
      opts.pin_store_path ?? defaultPinStorePath(),
    );
    const allowed = pin.status !== 'mismatch_refused';
    return {
      allowed,
      record: {
        transport,
        origin: opts.origin,
        origin_pin: opts.presented_fingerprint,
        pin_status: pin.status,
        quarantine_decision: allowed ? 'allowed' : 'refused',
        quarantine_reason:
          pin.status === 'first_use'
            ? 'tofu_first_use'
            : pin.status === 'matched'
              ? 'pin_matched'
              : 'pin_mismatch_refused',
      },
    };
  }

  return {
    allowed: false,
    record: {
      transport: 'unknown',
      ...(opts.origin ? { origin: opts.origin } : {}),
      pin_status: 'na',
      quarantine_decision: 'refused',
      quarantine_reason: 'unknown_transport',
    },
  };
}
