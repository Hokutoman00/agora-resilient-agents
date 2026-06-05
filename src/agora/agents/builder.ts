import { getDefaultVirtualModel, getTFClient } from '../../aegis/tf-client.js';

export async function runBuilder(research: string, partialReport?: string): Promise<string> {
  const mock = partialReport
    ? `${partialReport}\n\n[Recovery Coordinator completed the report from preserved ledger context]\n\nThe final customer-facing deliverable remains usable because the research artifact survived the provider failure, the report was reconstructed from the same evidence, and the verifier checks the recovered output before marking the task complete.`
    : `Provider Outage Impact Report\n\n${research
        .split('\n')
        .slice(0, 3)
        .join('\n')}\n\nRecommendation: communicate the outage plainly, keep user-critical deliverables flowing through fallback routes, and verify recovered outputs against a quality rubric before release.`;

  if (!process.env.TRUEFOUNDRY_API_KEY?.trim()) return mock;

  const client = getTFClient();
  const systemPrompt = partialReport
    ? 'You are a Recovery Coordinator Agent. The Builder agent failed. Complete the report using the research and the partial work provided.'
    : 'You are a Builder Agent. Synthesize the research into a 3-paragraph professional report.';
  const userContent = partialReport
    ? `Research:\n${research}\n\nPartial report (complete from here):\n${partialReport}`
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
