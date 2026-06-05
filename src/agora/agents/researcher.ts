import { getDefaultVirtualModel, getTFClient } from '../../aegis/tf-client.js';
import { shouldUseSimulation } from './runtime.js';

function mockResearch(topic: string): string {
  return `
- User task: ${topic}
- Provider outage affects time-sensitive AI workflows first: research, drafting, code review, and customer support responses.
- Competitors with single-provider dependencies risk stalled deliverables, partial answers, and customer-visible delay.
- Teams with gateway fallback, preserved intermediate artifacts, and verifier gates can keep the final user deliverable moving.
- Customer communication should name the degraded dependency, state what still works, and give a concrete recovery path.
- Success criteria: a useful final report, explicit failure evidence, and proof that quality did not silently drop after recovery.
`.trim();
}

export async function runResearcher(topic: string): Promise<string> {
  const mock = mockResearch(topic);
  if (shouldUseSimulation()) return mock;

  const client = getTFClient();
  const res = await client.chat.completions.create({
    model: getDefaultVirtualModel(),
    messages: [
      {
        role: 'system',
        content:
          'You are a Research Agent. Given a topic, produce 5-7 specific, factual bullet points about recent developments. Be concise.',
      },
      { role: 'user', content: `Research topic: ${topic}` },
    ],
    max_tokens: 400,
  });

  return res.choices[0]?.message?.content ?? mock;
}
