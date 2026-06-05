// Bedrock token-bucket vs request-quota throttle detector.
//
// Background: post-5/27, Bedrock-mantle exclusively reports token-bucket
// throttling on Opus 4.7-class models. Token-bucket throttling is
// transient (capacity refills over Retry-After seconds) and the right
// move is L3 same-vendor backoff, NOT L4 cross-vendor fallback.
//
// Conversely, the legacy `bedrock-runtime` path still occasionally reports
// hard request-quota exhaustion (account-level RPM caps). These won't
// recover on a short backoff; L4 cross-vendor swap is correct.
//
// Detection signals (in priority):
//   1. Retry-After header — if present AND short (<60s), token-bucket
//   2. Response body — "token bucket" / "tokens-per-minute" → token-bucket
//   3. Response body — "request quota" / "RPM" / "account-level" → request-quota
//   4. Otherwise unknown (caller falls back to current L4 behavior)

import type { BedrockThrottleKind } from '../aegis/types.js';

export interface ThrottleSignal {
  headers?: Record<string, string | undefined>;
  bodyText?: string;
}

export interface ThrottleClassification {
  kind: BedrockThrottleKind;
  retry_after_s?: number;
  evidence: string;
}

const TOKEN_BUCKET_RE = /token[ -]bucket|tokens?[ -]per[ -]minute|TPM\b/i;
const REQUEST_QUOTA_RE = /request quota|RPM\b|account[ -]level (?:cap|limit)/i;

export function classifyThrottle(signal: ThrottleSignal): ThrottleClassification {
  const retryHeader = signal.headers?.['retry-after'] ?? signal.headers?.['Retry-After'];
  const retry_after_s = retryHeader ? Number.parseInt(retryHeader, 10) : undefined;
  const validRetry = typeof retry_after_s === 'number' && Number.isFinite(retry_after_s);

  if (signal.bodyText) {
    if (REQUEST_QUOTA_RE.test(signal.bodyText)) {
      return {
        kind: 'request_quota',
        ...(validRetry ? { retry_after_s } : {}),
        evidence: 'body_request_quota',
      };
    }
    if (TOKEN_BUCKET_RE.test(signal.bodyText)) {
      return {
        kind: 'token_bucket',
        ...(validRetry ? { retry_after_s } : {}),
        evidence: 'body_token_bucket',
      };
    }
  }

  // Header-only signal: a short Retry-After is overwhelmingly token-bucket.
  if (validRetry && retry_after_s !== undefined && retry_after_s <= 60) {
    return {
      kind: 'token_bucket',
      retry_after_s,
      evidence: 'header_retry_after_short',
    };
  }

  return { kind: 'unknown', evidence: 'no_signal' };
}
