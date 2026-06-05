// Bedrock-specific L4 rules. These extend the generic L4 catalog
// (l4-semantic.ts) with the error classes AWS Bedrock emits that
// TrueFoundry's default fallback codes [401,403,408,429,500,502,503] miss.
//
// The pattern is the same one we used to close the Anthropic
// "400 credit_balance_too_low" industry gap: a 4xx with a structured
// error.type that needs reclassification to be fallback-eligible.

import type { L4Rule } from './l4-semantic.js';

export const BEDROCK_L4_RULES: L4Rule[] = [
  // Bedrock token-bucket throttling (AWS 2026-05-27 split). Detected via
  // the ProviderError.throttle_kind field set by token-quota-detector.ts.
  // Action `pass_through` here is shorthand for "L3 same-vendor backoff":
  // we don't swap vendor; we wait Retry-After and retry the same Bedrock
  // endpoint. The L3 layer reads message_class === 'bedrock_token_bucket'
  // and performs the backoff. See docs/RECEIPT.md §C1.
  {
    id: 'bedrock.token_bucket.structured',
    matchProvider: '*',
    matchType: 'ThrottlingException',
    matchMessage: /token[ -]bucket|tokens?[ -]per[ -]minute|TPM\b/i,
    messageClass: 'bedrock_token_bucket',
    action: 'pass_through',
  },

  // Bedrock ThrottlingException — high-volume requests at the model level
  // trigger this; the request itself is well-formed (so default gateways
  // don't fall back).
  {
    id: 'bedrock.throttling.structured',
    matchProvider: '*',
    matchType: 'ThrottlingException',
    messageClass: 'bedrock_throttling',
    action: 'fallback_provider',
  },
  {
    id: 'bedrock.throttling.regex',
    matchMessage: /ThrottlingException|Too many requests, please wait before trying again/i,
    messageClass: 'bedrock_throttling',
    action: 'fallback_provider',
  },

  // Bedrock model quota exhaustion — TPM (tokens-per-minute) cap hit.
  // Returns 400 in some paths (not 429), missed by default fallback lists.
  {
    id: 'bedrock.quota_exceeded.structured',
    matchProvider: '*',
    matchType: 'ServiceQuotaExceededException',
    messageClass: 'bedrock_quota_exceeded',
    action: 'fallback_provider',
  },
  {
    id: 'bedrock.quota_exceeded.regex',
    matchMessage:
      /ServiceQuotaExceededException|exceeded.{0,30}quota|on-demand throughput isn't supported/i,
    messageClass: 'bedrock_quota_exceeded',
    action: 'fallback_provider',
  },

  // Bedrock streaming midstream error — partial response delivered then
  // connection drops. Treat as full failure and route to fallback.
  {
    id: 'bedrock.stream_error',
    matchType: 'ModelStreamErrorException',
    messageClass: 'bedrock_stream_error',
    action: 'fallback_provider',
  },

  // Bedrock model timeout — distinct from network timeout; the model
  // itself didn't return in time. Fallback to a smaller / faster model.
  {
    id: 'bedrock.model_timeout',
    matchType: 'ModelTimeoutException',
    messageClass: 'bedrock_model_timeout',
    action: 'fallback_model',
  },

  // Bedrock model access denied — first-time invoke on Anthropic models
  // requires use-case acceptance. Returns 403, fallback list catches 403
  // but the message context tells us to route AWAY from Anthropic Bedrock
  // entirely (acceptance won't complete in the request lifetime).
  {
    id: 'bedrock.access_denied.anthropic',
    matchStatus: 403,
    matchMessage: /AccessDeniedException.{0,80}anthropic|use case details.{0,40}submit/i,
    messageClass: 'bedrock_access_denied_anthropic',
    action: 'fallback_provider',
  },

  // Bedrock region-level outage — InternalServerException with region
  // identifier in message. Action is fallback_provider so we jump to a
  // different family (cross-region is handled by TF Virtual Model L3).
  {
    id: 'bedrock.region_outage',
    matchType: 'InternalServerException',
    messageClass: 'bedrock_region_outage',
    action: 'fallback_provider',
  },

  // Bedrock model not found — happens when a model ID is deprecated
  // or never enabled for the account. Different from generic unavailable;
  // we keep the same fallback action.
  {
    id: 'bedrock.validation.model',
    matchType: 'ValidationException',
    matchMessage: /model.{0,30}(not.{0,5}found|invalid|isn't supported)/i,
    messageClass: 'bedrock_validation_model',
    action: 'fallback_model',
  },

  // Bedrock guardrail intervention — the model wanted to respond but
  // a configured AWS Bedrock Guardrail blocked the output. Not really
  // a failure; treat as content_blocked and let the caller decide.
  {
    id: 'bedrock.guardrail_intervention',
    matchMessage: /GuardrailIntervention|blocked by.{0,20}guardrail/i,
    messageClass: 'bedrock_guardrail_blocked',
    action: 'pass_through',
  },
];
