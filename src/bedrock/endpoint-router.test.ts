import { describe, expect, test } from 'bun:test';
import { routeEndpoint } from './endpoint-router.js';

describe('bedrock endpoint-router (C1, AWS 2026-05-27 split)', () => {
  test('URL host bedrock-runtime → runtime', () => {
    const kind = routeEndpoint({
      url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude/invoke',
    });
    expect(kind).toBe('runtime');
  });

  test('URL host bedrock-mantle → mantle (Opus 4.7 path)', () => {
    const kind = routeEndpoint({
      url: 'https://bedrock-mantle.us-east-1.amazonaws.com/model/anthropic.claude-opus-4-7/invoke',
    });
    expect(kind).toBe('mantle');
  });

  test('explicit X-Amzn-Bedrock-Endpoint header overrides ambiguous URL', () => {
    const kind = routeEndpoint({
      url: 'https://example.invalid/proxy/bedrock',
      headers: { 'x-amzn-bedrock-endpoint': 'mantle' },
    });
    expect(kind).toBe('mantle');
  });

  test('no signal → unknown', () => {
    const kind = routeEndpoint({});
    expect(kind).toBe('unknown');
  });
});
