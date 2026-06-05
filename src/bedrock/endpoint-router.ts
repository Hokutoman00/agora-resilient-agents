// Bedrock endpoint router.
//
// Background (AWS 2026-05-27): AWS split the legacy `bedrock-runtime`
// endpoint into two:
//   - bedrock-runtime.{region}.amazonaws.com  → general-purpose invoke
//   - bedrock-mantle.{region}.amazonaws.com   → tiered models incl. Opus 4.7
//
// Resilience strategies differ. Mantle is gated by token-bucket throttling
// (transient, retry-friendly). Runtime still serves the legacy RPM-style
// throttling on some paths. Tagging requests at ingress lets L4 decide
// "same-vendor backoff" vs "cross-vendor fallback".
//
// Detection priority:
//   1. Explicit `X-Amzn-Bedrock-Endpoint` request/response header
//   2. URL host parsing (bedrock-runtime.* vs bedrock-mantle.*)
//   3. Unknown → caller treats as legacy runtime

import type { BedrockEndpointKind } from '../aegis/types.js';

export interface EndpointSignal {
  url?: string;
  headers?: Record<string, string | undefined>;
}

const HOST_RE = /\bbedrock-(runtime|mantle)\b/i;

export function routeEndpoint(signal: EndpointSignal): BedrockEndpointKind {
  // 1. Header explicit override (AWS will emit this on all 5/27+ responses).
  const headerVal =
    signal.headers?.['x-amzn-bedrock-endpoint'] ?? signal.headers?.['X-Amzn-Bedrock-Endpoint'];
  if (headerVal) {
    const v = headerVal.toLowerCase().trim();
    if (v === 'runtime' || v === 'mantle') return v;
  }

  // 2. URL host parsing.
  if (signal.url) {
    const m = signal.url.match(HOST_RE);
    if (m && (m[1] === 'runtime' || m[1] === 'mantle')) {
      return m[1] as BedrockEndpointKind;
    }
  }

  return 'unknown';
}
