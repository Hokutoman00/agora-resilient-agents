# Demo video narration — aegis-tf-resilient-online (3:30 target)

Same TTS pipeline as aegis-splunk: PowerShell SAPI Zira voice, SSML breaks aligned to scene timing, mux with `ffmpeg -i video.mp4 -i narration.wav -c:v copy -c:a aac -b:a 192k -shortest`.

## Scene plan (210s total)

| t | duration | scene | source |
|---|---|---|---|
| 0-4 | 4s | Title card | `01_title.png` |
| 4-10 | 6s | TF Gateway dashboard establishing shot | `02_tf_dashboard.png` |
| 10-25 | 15s | Bedrock Virtual Model config (anthropic→meta→mistral→nova) | `03_virtual_model_config.png` |
| 25-45 | 20s | `bun test` running, 75 pass green | screen-capture |
| 45-90 | 45s | `examples/bedrock-demo.ts` live trace, layer-by-layer | terminal record |
| 90-130 | 40s | Aegis Receipt JSON inspection (cross-family swap, fail-closed) | terminal + overlay |
| 130-170 | 40s | LiteLLM #24320 connection: "this is the gap" | issue screenshot + overlay |
| 170-195 | 25s | Architectural disclosure callout (DevNetwork win + new layers) | text overlay |
| 195-210 | 15s | Closing CTA: GitHub URL + license + Devpost | `08_closing.png` |

## Narration script (SSML)

```ssml
<speak>
<prosody rate="medium" volume="medium">

<!-- 0-4s title -->
aegis-tf-resilient-online. Hedge first, fallback second, continuously chaos-verified, for agents on TrueFoundry AI Gateway and AWS Bedrock.
<break time="500ms"/>

<!-- 4-10s establish -->
Every default LLM gateway in 2026 — LiteLLM, OpenRouter, Portkey, and TrueFoundry's own Virtual Model fallback — shares one architectural blind spot.
<break time="400ms"/>

<!-- 10-25s virtual model -->
The fallback rules fire on HTTP status codes: 401, 403, 408, 429, 500, 502, 503. But the most common production failures are 4xx errors with structured error type payloads. AWS Bedrock returns ThrottlingException with status 400. ServiceQuotaExceededException with 400. ModelTimeoutException with 408 but the model itself, not the network. None of these fall back automatically.
<break time="600ms"/>

<!-- 25-45s tests pass -->
We close that gap with nine Bedrock-specific Layer-4 reclassification rules. Each rule matches on the structured error type field, and a regex on the message for catalog completeness. Tests pass. Seventy-five out of seventy-five. Lint clean. Typecheck clean. Cross-family fallback chain verified: when Anthropic throttles, we never retry Anthropic. We jump to Meta. Or Mistral. Or Cohere. Or Amazon Nova. The chain is family-aware by construction.
<break time="700ms"/>

<!-- 45-90s live trace -->
Here is the end-to-end trace. User prompt enters. Aegis-local input guardrail checks for prompt injection probes and PII. Primary call to bedrock anthropic claude three-five sonnet. Throttling Exception returned, status four hundred. TrueFoundry's default fallback list does not include four hundred. Pass-through. Aegis L4 reclassifies: rule equals bedrock dot throttling dot structured. Action equals fallback provider. L3 cross-family picks Meta llama three eight b. Different vendor on the same Bedrock surface. Two hundred OK in four hundred eighty milliseconds.
<break time="600ms"/>

<!-- 90-130s receipt -->
The response carries a signed Aegis Receipt. It shows the primary model that was tried. The fallback that succeeded. The L4 rule that fired. The cross-family swap from Anthropic to Meta. The guardrail decision, including the fail-closed contract when the TrueFoundry Guardrails service itself is unavailable. And the last time Aegis survived a chaos drill.
<break time="500ms"/>

<!-- 130-170s LiteLLM gap -->
This is the same architectural gap documented in LiteLLM issue twenty-four thousand three hundred twenty. The industry-wide failure mode where credit balance too low passes through every default fallback because the HTTP code is in the four hundred range, not the failure-eligible list. We fix it for Bedrock. The pattern generalizes to every provider.
<break time="500ms"/>

<!-- 170-195s disclosure -->
Built on top of aegis-resilient-agents, which won the TrueFoundry Resilient Agents sub-track at DevNetwork twenty-twenty-six. The Bedrock provider configuration, the nine Bedrock-specific L4 rules, the composed Guardrails layer, and the demo scenario are new for this hackathon. The core hedge and fallback primitives are reused with disclosure.
<break time="500ms"/>

<!-- 195-210s closing -->
github dot com slash Hokutoman zero zero slash aegis-tf-resilient-online. MIT licensed. Verify in five minutes. Drop-in OpenAI-SDK compatible base URL.

</prosody>
</speak>
```

## PowerShell generation script (narration.ps1)

```powershell
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Zira Desktop')
$synth.Rate = 0
$synth.Volume = 100
$synth.SetOutputToWaveFile("$PSScriptRoot\narration.wav")
$ssml = Get-Content "$PSScriptRoot\narration.ssml" -Raw
$synth.SpeakSsml($ssml)
$synth.Dispose()
Write-Host "narration.wav generated"
```

## ffmpeg mux

```bash
ffmpeg -y -i aegis-tf-online-demo-silent.mp4 -i narration.wav \
  -c:v copy -c:a aac -b:a 192k -shortest \
  aegis-tf-online-demo-v1.mp4
```

## Title card text (01_title.png)

- Top: "aegis-tf-resilient-online"
- Subtitle: "TF Resilient Agents — Online Hackathon 2026"
- Bottom: "Hedge first · Fallback second · Chaos-verified continuously"

## Closing card text (08_closing.png)

- "github.com/Hokutoman00/aegis-tf-resilient-online"
- "MIT License"
- "Verify in 5 minutes: bun test"
- "Built on aegis-resilient-agents (DevNetwork TF Resilient winner 2026)"
