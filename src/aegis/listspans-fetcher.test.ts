import { describe, expect, test } from 'bun:test';
import {
  type ListSpansPolicyAssessment,
  type ListSpansTransport,
  fetchListSpans,
} from './listspans-fetcher.js';

describe('listspans-fetcher (C3, AWS 2026-05-22 ListSpans)', () => {
  test('successful fetch returns per-policy assessment', async () => {
    const policies: ListSpansPolicyAssessment[] = [
      { policy_id: 'pii.email', category: 'pii', action: 'masked', confidence: 0.94 },
      { policy_id: 'toxic.hate', category: 'safety', action: 'blocked', confidence: 0.88 },
    ];
    const transport: ListSpansTransport = async () => policies;
    const res = await fetchListSpans('span-abc', transport);
    expect(res.status).toBe('ok');
    expect(res.policies.length).toBe(2);
    expect(res.policies[0]?.policy_id).toBe('pii.email');
  });

  test('timeout produces fallback record (status=timeout, empty policies)', async () => {
    const transport: ListSpansTransport = async (_id, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const res = await fetchListSpans('span-slow', transport, 20);
    expect(res.status).toBe('timeout');
    expect(res.policies).toEqual([]);
  });

  test('multi-policy fan-out is preserved', async () => {
    const transport: ListSpansTransport = async () => [
      { policy_id: 'a', category: 'pii', action: 'masked', confidence: 0.5 },
      { policy_id: 'b', category: 'pii', action: 'masked', confidence: 0.6 },
      { policy_id: 'c', category: 'safety', action: 'blocked', confidence: 0.9 },
    ];
    const res = await fetchListSpans('span-multi', transport);
    expect(res.policies.length).toBe(3);
  });
});
