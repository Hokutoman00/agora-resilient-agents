// Guardrails layer (TF Guardrails + Bedrock Guardrails, composed).
//
// This is the new layer for the TF Resilient Online Hackathon, sitting
// between the Aegis Receipt and the user-facing response. Two parallel
// guardrail systems run on every call:
//
//   1. TF Gateway Guardrails (configured on the dashboard, applied to all
//      requests routed through TF). Catches prompt injection, PII leakage,
//      tool-arg validation.
//   2. Optional AWS Bedrock Guardrails (configured per model invocation).
//      Catches content policy violations specific to the agent's domain.
//
// Resilience contract: if a guardrail SERVICE itself fails (TF Guardrails
// API timeout, Bedrock Guardrail not configured), Aegis chooses
// fail-closed for output filters (don't expose unfiltered content) but
// fail-open for input rate-limit-only guards (don't block users from
// hitting their own agent).

import {
  type ListSpansResult,
  type ListSpansTransport,
  fetchListSpans,
  unavailableResult,
} from './listspans-fetcher.js';

export type GuardrailDecision = 'allow' | 'block' | 'redact' | 'flag';
export type GuardrailStage = 'input' | 'tool_args' | 'tool_result' | 'output';

export interface GuardrailHit {
  stage: GuardrailStage;
  guardrail_source: 'tf_gateway' | 'bedrock_guardrail' | 'aegis_local';
  policy_id: string;
  decision: GuardrailDecision;
  redacted_spans?: Array<{ start: number; end: number; label: string }>;
  message?: string;
}

export interface GuardrailReport {
  stage: GuardrailStage;
  hits: GuardrailHit[];
  decision: GuardrailDecision; // Most-conservative aggregate
  // If any guardrail SERVICE failed, this is set; downstream uses it
  // to decide whether to apply the fail-closed / fail-open contract.
  service_errors: Array<{ source: 'tf_gateway' | 'bedrock_guardrail'; reason: string }>;
}

// Aegis-local pattern checks. These run even when TF Guardrails / Bedrock
// Guardrails services fail — they're cheap, deterministic, and exist to
// cover the fail-closed contract.
const LOCAL_INPUT_PATTERNS: Array<{
  id: string;
  re: RegExp;
  decision: GuardrailDecision;
  label: string;
}> = [
  // Classic prompt-injection probes
  {
    id: 'local.injection.ignore',
    re: /ignore (all )?(previous|prior|above) (instructions|prompts?)/i,
    decision: 'block',
    label: 'prompt_injection_ignore_prior',
  },
  {
    id: 'local.injection.system',
    re: /you are now (a |an )?(?:[a-z ]+with no restrictions|DAN|jailbroken)/i,
    decision: 'block',
    label: 'prompt_injection_persona_swap',
  },
  // PII patterns we don't want echoed back into prompts (low recall, high precision)
  {
    id: 'local.pii.email',
    re: /[\w.+-]+@[\w-]+\.[\w.-]+/g,
    decision: 'redact',
    label: 'pii_email',
  },
  {
    id: 'local.pii.creditcard',
    re: /\b(?:\d[ -]*?){13,16}\b/g,
    decision: 'redact',
    label: 'pii_credit_card_candidate',
  },
];

export function localInputCheck(text: string, stage: GuardrailStage = 'input'): GuardrailReport {
  const hits: GuardrailHit[] = [];
  for (const pattern of LOCAL_INPUT_PATTERNS) {
    const matches = Array.from(
      text.matchAll(
        new RegExp(
          pattern.re.source,
          pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`,
        ),
      ),
    );
    if (matches.length === 0) continue;
    const redacted_spans =
      pattern.decision === 'redact'
        ? matches.map((m) => ({
            start: m.index ?? 0,
            end: (m.index ?? 0) + m[0].length,
            label: pattern.label,
          }))
        : undefined;
    hits.push({
      stage,
      guardrail_source: 'aegis_local',
      policy_id: pattern.id,
      decision: pattern.decision,
      redacted_spans,
    });
  }
  return {
    stage,
    hits,
    decision: aggregateDecision(hits),
    service_errors: [],
  };
}

// Most-conservative aggregate: block > redact > flag > allow.
export function aggregateDecision(hits: GuardrailHit[]): GuardrailDecision {
  const decisions = new Set(hits.map((h) => h.decision));
  if (decisions.has('block')) return 'block';
  if (decisions.has('redact')) return 'redact';
  if (decisions.has('flag')) return 'flag';
  return 'allow';
}

// Apply a redaction report to a string, replacing each redacted span with
// a labeled placeholder. Idempotent on already-redacted text.
export function applyRedactions(text: string, report: GuardrailReport): string {
  const redactSpans = report.hits
    .flatMap((h) => h.redacted_spans ?? [])
    .sort((a, b) => b.start - a.start); // Apply from the end to keep indices valid
  let out = text;
  for (const span of redactSpans) {
    out = `${out.slice(0, span.start)}[REDACTED:${span.label}]${out.slice(span.end)}`;
  }
  return out;
}

// fail-closed for output stage: if a guardrail SERVICE failed and we can't
// verify the output is safe, we return a sanitized version (or block) rather
// than passing through unverified content.
export function applyFailClosedContract(
  report: GuardrailReport,
  stage: GuardrailStage,
): GuardrailReport {
  if (report.service_errors.length === 0) return report;
  // Output / tool_result stages are fail-closed
  if (stage === 'output' || stage === 'tool_result') {
    return {
      ...report,
      decision: 'block',
      hits: [
        ...report.hits,
        {
          stage,
          guardrail_source: 'aegis_local',
          policy_id: 'aegis.fail_closed.service_error',
          decision: 'block',
          message: `Guardrail service errors prevented verification: ${report.service_errors.map((e) => e.source).join(', ')}`,
        },
      ],
    };
  }
  // Input stage is fail-open (don't lock users out of their own agent)
  return report;
}

// C3 — On a Bedrock GuardrailIntervention, fetch the per-policy
// assessment from ListSpans and produce a Receipt-embedded record.
// If transport is undefined (running outside AWS), returns an
// unavailable record so the Receipt still attests intervention happened.
export async function onBedrockGuardrailIntervention(
  spanId: string,
  transport?: ListSpansTransport,
): Promise<ListSpansResult> {
  if (!transport) return unavailableResult(spanId);
  return fetchListSpans(spanId, transport);
}

export type { ListSpansResult } from './listspans-fetcher.js';
