// AWS Bedrock provider configuration for the TF Resilient Online Hackathon.
//
// All Bedrock model calls go through the TrueFoundry AI Gateway (judging
// criteria #1). Aegis composes its hedge/L4/L6 layers on top of TF's L1-L3.
//
// The Virtual Model on the TF dashboard is configured with a fallback chain:
//   primary:   bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0
//   fallback1: bedrock/anthropic.claude-3-haiku-20240307-v1:0
//   fallback2: bedrock/meta.llama3-8b-instruct-v1:0
//   fallback3: bedrock/mistral.mistral-7b-instruct-v0:2
//   fallback4: bedrock/cohere.command-r-v1:0
//
// Cross-region inference profiles (us-east-1 → us-west-2) are enabled on the
// TF side so a single-region Bedrock outage doesn't take us down.

export const BEDROCK_MODELS = {
  // Anthropic on Bedrock (first-time users may need use-case acceptance,
  // see AWS console → Bedrock → Model access)
  ANTHROPIC_CLAUDE_SONNET: 'bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0',
  ANTHROPIC_CLAUDE_HAIKU: 'bedrock/anthropic.claude-3-haiku-20240307-v1:0',

  // Meta Llama 3 on Bedrock (serverless, auto-enabled)
  META_LLAMA3_8B: 'bedrock/meta.llama3-8b-instruct-v1:0',
  META_LLAMA3_70B: 'bedrock/meta.llama3-70b-instruct-v1:0',

  // Mistral on Bedrock
  MISTRAL_7B: 'bedrock/mistral.mistral-7b-instruct-v0:2',
  MISTRAL_LARGE: 'bedrock/mistral.mistral-large-2402-v1:0',

  // Cohere on Bedrock — useful as a non-Anthropic non-OpenAI fallback
  COHERE_COMMAND_R: 'bedrock/cohere.command-r-v1:0',

  // Amazon's own Nova family — last-resort fallback (always available)
  AMAZON_NOVA_LITE: 'bedrock/amazon.nova-lite-v1:0',
  AMAZON_NOVA_MICRO: 'bedrock/amazon.nova-micro-v1:0',
} as const;

export type BedrockModel = (typeof BEDROCK_MODELS)[keyof typeof BEDROCK_MODELS];

// Provider family classification — used by L4 to pick a non-same-family
// fallback when a whole vendor goes down (e.g., all Anthropic Bedrock models
// throttled at once during a region-wide spike).
export function bedrockFamily(
  model: string,
): 'anthropic' | 'meta' | 'mistral' | 'cohere' | 'amazon' | 'unknown' {
  if (!model.startsWith('bedrock/')) return 'unknown';
  const id = model.slice('bedrock/'.length);
  if (id.startsWith('anthropic.')) return 'anthropic';
  if (id.startsWith('meta.')) return 'meta';
  if (id.startsWith('mistral.')) return 'mistral';
  if (id.startsWith('cohere.')) return 'cohere';
  if (id.startsWith('amazon.')) return 'amazon';
  return 'unknown';
}

// Cross-family fallback chain. When L4 catches a Bedrock-specific error
// (throttling, quota exhaustion, model unavailable), we jump to a different
// family rather than retrying the same vendor that's having issues.
export const BEDROCK_CROSS_FAMILY_FALLBACK: Record<string, string[]> = {
  anthropic: [
    BEDROCK_MODELS.META_LLAMA3_8B,
    BEDROCK_MODELS.MISTRAL_7B,
    BEDROCK_MODELS.AMAZON_NOVA_LITE,
  ],
  meta: [
    BEDROCK_MODELS.MISTRAL_7B,
    BEDROCK_MODELS.COHERE_COMMAND_R,
    BEDROCK_MODELS.AMAZON_NOVA_LITE,
  ],
  mistral: [
    BEDROCK_MODELS.META_LLAMA3_8B,
    BEDROCK_MODELS.COHERE_COMMAND_R,
    BEDROCK_MODELS.AMAZON_NOVA_LITE,
  ],
  cohere: [
    BEDROCK_MODELS.META_LLAMA3_8B,
    BEDROCK_MODELS.MISTRAL_7B,
    BEDROCK_MODELS.AMAZON_NOVA_LITE,
  ],
  amazon: [
    BEDROCK_MODELS.META_LLAMA3_8B,
    BEDROCK_MODELS.MISTRAL_7B,
    BEDROCK_MODELS.COHERE_COMMAND_R,
  ],
  unknown: [BEDROCK_MODELS.AMAZON_NOVA_LITE],
};

export function pickBedrockCrossFamilyFallback(
  originalModel: string,
  alreadyTried: Set<string>,
): string | null {
  const family = bedrockFamily(originalModel);
  const chain =
    BEDROCK_CROSS_FAMILY_FALLBACK[family] ?? BEDROCK_CROSS_FAMILY_FALLBACK.unknown ?? [];
  for (const candidate of chain) {
    if (!alreadyTried.has(candidate)) return candidate;
  }
  return null;
}
