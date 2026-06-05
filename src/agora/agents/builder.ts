import { getDefaultVirtualModel, getTFClient } from '../../aegis/tf-client.js';

export type BuilderMode = 'draft' | 'recover' | 'revise';

export async function runBuilder(research: string, context?: string, mode: BuilderMode = context ? 'recover' : 'draft'): Promise<string> {
  const baseReport = `Provider Outage Impact Report\n\n${research
        .split('\n')
        .slice(0, 3)
        .join('\n')}\n\nRecommendation: communicate the outage plainly, keep user-critical deliverables flowing through fallback routes, and verify recovered outputs against a quality rubric before release.`;
  const mock = context
    ? mode === 'revise'
      ? `${baseReport}\n\n[Builder revised after peer critique]\n\nRevision evidence: adds a quantified recovery timeline, names the preserved ledger artifact as the source of continuity, and tightens customer communication around what remains available during fallback.\n\nCritique addressed:\n${context}`
      : `${context}\n\n[Recovery Coordinator completed the report from preserved ledger context]\n\nThe final customer-facing deliverable remains usable because the research artifact survived the provider failure, the report was reconstructed from the same evidence, and the verifier checks the recovered output before marking the task complete.`
    : baseReport;

  if (!process.env.TRUEFOUNDRY_API_KEY?.trim()) return mock;

  const client = getTFClient();
  const systemPrompt =
    mode === 'revise'
      ? 'You are a Builder Agent revising your report after peer critique. Preserve valid evidence, fix the specific issues, and return a concise professional report.'
      : context
        ? 'You are a Recovery Coordinator Agent. The Builder agent failed. Complete the report using the research and the partial work provided.'
        : 'You are a Builder Agent. Synthesize the research into a 3-paragraph professional report.';
  const userContent =
    mode === 'revise'
      ? `Research:\n${research}\n\nRevision guidance:\n${context}`
      : context
        ? `Research:\n${research}\n\nPartial report (complete from here):\n${context}`
        : `Research:\n${research}`;

  const res = await client.chat.completions.create({
    model: getDefaultVirtualModel(),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_tokens: 600,
  });

  return res.choices[0]?.message?.content ?? mock;
}
