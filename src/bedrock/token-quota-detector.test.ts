import { describe, expect, test } from 'bun:test';
import { classifyThrottle } from './token-quota-detector.js';

describe('bedrock token-quota-detector (C1)', () => {
  test('body mentioning "token bucket" → token_bucket (L3 backoff path)', () => {
    const c = classifyThrottle({
      bodyText: 'Token bucket exhausted. Wait for tokens to replenish.',
      headers: { 'retry-after': '12' },
    });
    expect(c.kind).toBe('token_bucket');
    expect(c.retry_after_s).toBe(12);
  });

  test('body mentioning "request quota" → request_quota (L4 swap path)', () => {
    const c = classifyThrottle({
      bodyText: 'Account-level request quota exceeded. Contact AWS support.',
    });
    expect(c.kind).toBe('request_quota');
  });

  test('short Retry-After header alone → token_bucket', () => {
    const c = classifyThrottle({
      headers: { 'Retry-After': '5' },
    });
    expect(c.kind).toBe('token_bucket');
    expect(c.retry_after_s).toBe(5);
  });

  test('no signal → unknown', () => {
    const c = classifyThrottle({});
    expect(c.kind).toBe('unknown');
  });
});
