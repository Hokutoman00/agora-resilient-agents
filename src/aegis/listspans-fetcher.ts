// AWS Bedrock ListSpans fetcher (C3).
//
// Background (AWS 2026-05-22): Bedrock now exposes per-policy guardrail
// assessment results via ListSpans. On GuardrailIntervention, we
// asynchronously fetch the assessment within 5s and embed exactly which
// policies fired (so the Receipt is auditable to a policy_id level).
//
// On timeout/failure we fall back to a synthetic record so the Receipt
// still attests "an assessment was attempted; ListSpans was unreachable".
//
// The fetcher accepts a pluggable transport for testability — the default
// uses native fetch with AbortSignal.timeout(5000).

export interface ListSpansPolicyAssessment {
  policy_id: string;
  category: string;
  action: 'blocked' | 'masked' | 'flagged';
  confidence: number;
}

export interface ListSpansResult {
  span_id: string;
  fetched_at: string;
  status: 'ok' | 'timeout' | 'error' | 'unavailable';
  policies: ListSpansPolicyAssessment[];
  error_message?: string;
}

export type ListSpansTransport = (
  spanId: string,
  signal: AbortSignal,
) => Promise<ListSpansPolicyAssessment[]>;

export const LISTSPANS_TIMEOUT_MS = 5000;

export async function fetchListSpans(
  spanId: string,
  transport: ListSpansTransport,
  timeoutMs: number = LISTSPANS_TIMEOUT_MS,
): Promise<ListSpansResult> {
  const fetched_at = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const policies = await transport(spanId, controller.signal);
    return { span_id: spanId, fetched_at, status: 'ok', policies };
  } catch (err) {
    const isAbort = (err as { name?: string })?.name === 'AbortError' || controller.signal.aborted;
    return {
      span_id: spanId,
      fetched_at,
      status: isAbort ? 'timeout' : 'error',
      policies: [],
      error_message: (err as Error)?.message ?? 'unknown',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Helper for callers that have no ListSpans transport (e.g. running outside AWS).
export function unavailableResult(spanId: string): ListSpansResult {
  return {
    span_id: spanId,
    fetched_at: new Date().toISOString(),
    status: 'unavailable',
    policies: [],
    error_message: 'ListSpans transport not configured',
  };
}
