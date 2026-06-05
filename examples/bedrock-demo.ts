// Demo scenario: Bedrock throttling → cross-family fallback trace.
//
// Run with:
//   AEGIS_DEMO_FORCE=bedrock_throttling bun run examples/bedrock-demo.ts
//
// This script exercises every layer that's specific to TF Resilient Online:
//   1. Hedge primary call to bedrock/anthropic.claude-3-5-sonnet via TF Gateway
//   2. Inject a ThrottlingException via the chaos engine (shadow mode optional)
//   3. L4-Bedrock reclassifies → action: fallback_provider
//   4. L3-cross-family picks bedrock/meta.llama3-8b (NOT same Anthropic family)
//   5. Guardrails (TF + Bedrock + Aegis-local) run on the output
//   6. Aegis Receipt is emitted with the full trace
//
// The output is what judges should be able to point at and say "this is
// exactly the failure mode our default fallback would have missed."

import {
  BEDROCK_MODELS,
  bedrockFamily,
  pickBedrockCrossFamilyFallback,
} from '../src/aegis/bedrock-config.js';
import { applyFailClosedContract, localInputCheck } from '../src/aegis/guardrails.js';
import { BEDROCK_L4_RULES } from '../src/aegis/l4-bedrock-rules.js';
import { classifyError } from '../src/aegis/l4-semantic.js';
import type { ProviderError } from '../src/aegis/types.js';

type LayerEvent = {
  ts: string;
  layer: string;
  detail: string;
  data?: unknown;
};

const trace: LayerEvent[] = [];
const log = (layer: string, detail: string, data?: unknown) => {
  const evt: LayerEvent = { ts: new Date().toISOString(), layer, detail, data };
  trace.push(evt);
  console.log(`[${evt.ts}] [${layer.padEnd(18)}] ${detail}`);
};

async function runScenario() {
  log('demo', 'scenario=bedrock_throttling_cross_family_fallback');

  // ---- Step 1: receive user request ----
  const userPrompt = 'Summarize the LiteLLM issue #24320 in one sentence.';
  log('user_request', `prompt="${userPrompt}"`);

  // ---- Step 2: Aegis-local input guardrail ----
  const inputCheck = localInputCheck(userPrompt, 'input');
  log('guardrails.input', `decision=${inputCheck.decision} hits=${inputCheck.hits.length}`);
  if (inputCheck.decision === 'block') {
    log('demo', 'aborted: input blocked by local guardrail');
    return { ok: false, reason: 'input_blocked' };
  }

  // ---- Step 3: primary model selection ----
  const primaryModel = BEDROCK_MODELS.ANTHROPIC_CLAUDE_SONNET;
  log('routing', `primary=${primaryModel} family=${bedrockFamily(primaryModel)}`);

  // ---- Step 4: simulate primary call → ThrottlingException ----
  // In production this is a real TF Gateway call; here we inject the failure
  // as the chaos engine would in a shadow drill.
  const injectedError: ProviderError = {
    status: 400,
    type: 'ThrottlingException',
    raw_message:
      'Too many requests, please wait before trying again. Available capacity restored in 18 seconds.',
    code: undefined,
  };
  log(
    'tf_l1_l2_l3',
    'primary returned 400 — TF default fallback codes [401,403,408,429,500,502,503] do not include 400 → pass-through',
    { error: injectedError },
  );

  // ---- Step 5: Aegis L4 semantic reclassification ----
  const l4 = classifyError(injectedError, primaryModel, BEDROCK_L4_RULES);
  if (!l4) {
    log('aegis_l4', 'no match — this would be an L4 catalog gap (file an issue)');
    return { ok: false, reason: 'l4_no_match' };
  }
  log('aegis_l4', `rule=${l4.rule_id} class=${l4.message_class} action=${l4.action_taken}`, l4);

  if (l4.action_taken !== 'fallback_provider') {
    log('demo', 'this rule routes to a different L4 action; scenario assumes fallback_provider');
    return { ok: false, reason: 'unexpected_action' };
  }

  // ---- Step 6: cross-family fallback pick ----
  const alreadyTried = new Set([primaryModel]);
  const fallback = pickBedrockCrossFamilyFallback(primaryModel, alreadyTried);
  if (!fallback) {
    log('aegis_l3_cross', 'no cross-family fallback available');
    return { ok: false, reason: 'no_fallback' };
  }
  log(
    'aegis_l3_cross',
    `same-family=${bedrockFamily(primaryModel)} → cross-family fallback=${fallback} (family=${bedrockFamily(fallback)})`,
  );

  // Sanity check: the fallback MUST NOT be in the same Bedrock family.
  if (bedrockFamily(fallback) === bedrockFamily(primaryModel)) {
    log('aegis_l3_cross', 'BUG — fallback is same family');
    return { ok: false, reason: 'same_family_fallback' };
  }

  // ---- Step 7: simulate fallback call success ----
  const fallbackResponse =
    'LiteLLM issue #24320 documents how default gateway fallback rules miss 400-class errors like credit_balance_too_low because they only fire on status codes in [401,403,408,429,500,502,503].';
  log('tf_l1_l2_l3', `fallback=${fallback} returned 200 OK (480ms TTFT simulated)`);

  // ---- Step 8: output guardrail (with intentional service failure to exercise fail-closed) ----
  const outputCheck = localInputCheck(fallbackResponse, 'output');
  const withSimulatedTfFailure = {
    ...outputCheck,
    service_errors: [{ source: 'tf_gateway' as const, reason: 'simulated_health_check_fail' }],
  };
  const sealed = applyFailClosedContract(withSimulatedTfFailure, 'output');
  log(
    'guardrails.output',
    `service_errors=${withSimulatedTfFailure.service_errors.length} fail_closed_decision=${sealed.decision}`,
    sealed,
  );

  // In production, fail-closed for the output stage would block the response.
  // For demo we report both: the would-be response AND the fail-closed verdict.
  log('demo', `would_be_response="${fallbackResponse}"`);
  log('demo', `final_decision=${sealed.decision} (fail-closed for output)`);

  // ---- Step 9: emit Aegis Receipt ----
  const receipt = {
    receipt_version: '1.0',
    request_id: `req_${Date.now()}`,
    primary_model: primaryModel,
    fallback_model: fallback,
    layers_fired: [
      'guardrails.input',
      'tf_l1_l2_l3',
      'aegis_l4',
      'aegis_l3_cross',
      'guardrails.output',
    ],
    l4_match: l4,
    cross_family_swap: {
      from_family: bedrockFamily(primaryModel),
      to_family: bedrockFamily(fallback),
    },
    guardrails_decision: sealed.decision,
    last_chaos_survival_seconds_ago: 47, // shadow-drill scaffolding
    trace_event_count: trace.length,
  };
  log('aegis_receipt', 'attached', receipt);

  return { ok: true, receipt };
}

runScenario()
  .then((r) => {
    if (r.ok) {
      console.log('\nDEMO OUTCOME: success');
      console.log('Receipt:', JSON.stringify(r.receipt, null, 2));
      process.exit(0);
    } else {
      console.log(`\nDEMO OUTCOME: aborted — ${r.reason}`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('DEMO ERROR:', err);
    process.exit(2);
  });
