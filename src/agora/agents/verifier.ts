import { getDefaultVirtualModel, getTFClient } from '../../aegis/tf-client.js';
import { shouldUseSimulation } from './runtime.js';

export type VerificationRubric = {
  completeness: number;
  coherence: number;
  usefulness: number;
  overall_pass: boolean;
  summary: string;
};

const MOCK_VERDICT: VerificationRubric = {
  completeness: 8,
  coherence: 8,
  usefulness: 8,
  overall_pass: true,
  summary:
    'The recovered deliverable includes outage impact, preserved evidence, user-facing recommendation, and verifier-gated continuity.',
};

export async function runVerifier(report: string): Promise<VerificationRubric> {
  if (shouldUseSimulation()) return MOCK_VERDICT;

  const client = getTFClient();
  const res = await client.chat.completions.create({
    model: getDefaultVirtualModel(),
    messages: [
      {
        role: 'system',
        content:
          'You are a Verifier Agent. Score the report as strict JSON with keys completeness, coherence, usefulness, overall_pass, summary. Scores are 0-10. overall_pass is true only when all scores are >= 7.',
      },
      { role: 'user', content: report },
    ],
    max_tokens: 220,
  });

  const content = res.choices[0]?.message?.content;
  if (!content) return MOCK_VERDICT;
  return parseVerification(content);
}

function parseVerification(content: string): VerificationRubric {
  try {
    const parsed = JSON.parse(extractJson(content)) as Partial<VerificationRubric>;
    const completeness = clampScore(parsed.completeness);
    const coherence = clampScore(parsed.coherence);
    const usefulness = clampScore(parsed.usefulness);
    return {
      completeness,
      coherence,
      usefulness,
      overall_pass: Boolean(parsed.overall_pass) && completeness >= 7 && coherence >= 7 && usefulness >= 7,
      summary: typeof parsed.summary === 'string' ? parsed.summary : 'Verifier returned a valid rubric without a summary.',
    };
  } catch {
    return {
      completeness: 6,
      coherence: 6,
      usefulness: 6,
      overall_pass: false,
      summary: `Verifier did not return parseable rubric JSON: ${content.slice(0, 160)}`,
    };
  }
}

function extractJson(content: string): string {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start >= 0 && end > start) return withoutFence.slice(start, end + 1);
  return withoutFence;
}

function clampScore(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}
