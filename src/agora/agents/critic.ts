import { getDefaultVirtualModel, getTFClient } from '../../aegis/tf-client.js';

export type CriticFeedback = {
  issues: string[];
  severity: 'major' | 'minor' | 'none';
  revised_guidance: string;
};

const MOCK_FEEDBACK: CriticFeedback = {
  issues: [
    'The draft does not quantify the recovery timeline.',
    'The draft should name which preserved artifact lets the workflow continue.',
  ],
  severity: 'minor',
  revised_guidance:
    'Add a concrete recovery timeline, name the shared ledger research artifact, and make the customer communication action more specific.',
};

const CLEAN_FEEDBACK: CriticFeedback = {
  issues: [],
  severity: 'none',
  revised_guidance: 'No material logical gaps found.',
};

export async function runCritic(topic: string, research: string, report: string): Promise<CriticFeedback> {
  const lower = report.toLowerCase();
  const mock = lower.includes('quantified') && lower.includes('ledger') ? CLEAN_FEEDBACK : MOCK_FEEDBACK;
  if (!process.env.TRUEFOUNDRY_API_KEY?.trim()) return mock;

  const client = getTFClient();
  const res = await client.chat.completions.create({
    model: getDefaultVirtualModel(),
    messages: [
      {
        role: 'system',
        content:
          'You are a Critic Agent. Review the report for logical gaps, unsupported claims, missing evidence, and weak customer impact. Return strict JSON with keys issues, severity, revised_guidance. severity is major, minor, or none.',
      },
      {
        role: 'user',
        content: `Topic:\n${topic}\n\nResearch:\n${research}\n\nReport:\n${report}`,
      },
    ],
    max_tokens: 300,
  });

  const content = res.choices[0]?.message?.content;
  if (!content) return mock;
  return parseCriticFeedback(content);
}

function parseCriticFeedback(content: string): CriticFeedback {
  try {
    const parsed = JSON.parse(extractJson(content)) as Partial<CriticFeedback>;
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((issue): issue is string => typeof issue === 'string').slice(0, 5)
      : [];
    const severity = parsed.severity === 'major' || parsed.severity === 'minor' || parsed.severity === 'none'
      ? parsed.severity
      : issues.length
        ? 'minor'
        : 'none';
    return {
      issues,
      severity,
      revised_guidance:
        typeof parsed.revised_guidance === 'string'
          ? parsed.revised_guidance
          : issues.length
            ? issues.join(' ')
            : 'No material logical gaps found.',
    };
  } catch {
    return {
      issues: [`Critic did not return parseable JSON: ${content.slice(0, 160)}`],
      severity: 'minor',
      revised_guidance: 'Revise conservatively: make claims specific, evidence-backed, and customer-actionable.',
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
