## Generate narration WAV for aegis-tf-resilient-online demo video using Windows SAPI.
## Aligned to demo/video/narration-bedrock.md scene plan (210s target).

Add-Type -AssemblyName System.Speech

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 3
"Available English voices:"
$voices | ForEach-Object { "  - $($_.VoiceInfo.Name) ($($_.VoiceInfo.Culture.Name))" }

$preferredVoice = $voices | Where-Object { $_.VoiceInfo.Name -like '*Zira*' } | Select-Object -First 1
if (-not $preferredVoice) { $preferredVoice = $voices | Select-Object -First 1 }
if ($preferredVoice) {
  $synth.SelectVoice($preferredVoice.VoiceInfo.Name)
  "Using voice: $($preferredVoice.VoiceInfo.Name)"
}

$synth.Rate = -1
$synth.Volume = 100

$ssml = @'
<speak version="1.0" xml:lang="en-US" xmlns="http://www.w3.org/2001/10/synthesis">
<break time="2000ms"/>
<prosody rate="0.95">aegis tf resilient online. Hedge first, fallback second, continuously chaos verified, for agents on TrueFoundry AI Gateway and AWS Bedrock.</prosody>
<break time="700ms"/>
<prosody rate="0.95">Every default LLM gateway in 2026, LiteLLM, OpenRouter, Portkey, and TrueFoundry's own Virtual Model fallback, shares one architectural blind spot.</prosody>
<break time="500ms"/>
<prosody rate="0.95">The fallback rules fire on HTTP status codes: four oh one, four oh three, four oh eight, four twenty nine, five hundred, five oh two, five oh three. But the most common production failures are four x x errors with structured error type payloads. AWS Bedrock returns Throttling Exception with status four hundred. Service Quota Exceeded Exception with four hundred. None of these fall back automatically.</prosody>
<break time="600ms"/>
<prosody rate="0.95">We close that gap with nine Bedrock specific Layer Four reclassification rules. Each rule matches on the structured error type field, and a regex on the message for catalog completeness. One hundred tests pass. Zero fail. Lint clean. Typecheck clean. Cross family fallback chain verified.</prosody>
<break time="700ms"/>
<prosody rate="0.95">Here is the end to end trace. User prompt enters. Aegis local input guardrail checks for prompt injection and P I I. Primary call to Bedrock anthropic claude three five sonnet. Throttling Exception returned, status four hundred. TrueFoundry default fallback list does not include four hundred. Pass through. Aegis L four reclassifies, rule equals bedrock dot throttling. Action equals fallback provider. L three cross family picks Meta llama three eight b. Different vendor on the same Bedrock surface. Two hundred OK in four eighty milliseconds.</prosody>
<break time="600ms"/>
<prosody rate="0.95">The response carries a signed Aegis Receipt in A I V S format. It shows the primary model tried. The fallback that succeeded. The L four rule that fired. The cross family swap from Anthropic to Meta. The guardrail decision. And the last time Aegis survived a chaos drill. The bundle includes an audit log, a manifest, and an ed two five five one nine signature.</prosody>
<break time="500ms"/>
<prosody rate="0.95">This is the same architectural gap documented in LiteLLM issue twenty four thousand three hundred twenty. The industry wide failure where credit balance too low passes through every default fallback because the HTTP code is four hundred, not in the failure eligible list. We fix it for Bedrock. The pattern generalizes.</prosody>
<break time="500ms"/>
<prosody rate="0.95">Built on top of aegis resilient agents, winner of the TrueFoundry Resilient Agents sub track at DevNetwork twenty twenty six. The Bedrock provider config, the nine L four rules, the composed Guardrails, the AIVS envelope, and the demo are new for this hackathon. Core primitives reused with disclosure.</prosody>
<break time="500ms"/>
<prosody rate="0.95">github dot com slash Hokuto man zero zero slash aegis tf resilient online. MIT licensed. Verify in five minutes. Drop in OpenAI SDK compatible base URL.</prosody>
<break time="1500ms"/>
</speak>
'@

$outFile = "$PSScriptRoot\narration.wav"
$synth.SetOutputToWaveFile($outFile)
$synth.SpeakSsml($ssml)
$synth.Dispose()

if (Test-Path $outFile) {
  $size = [math]::Round((Get-Item $outFile).Length / 1KB, 1)
  "Wrote $outFile ($size KB)"
} else {
  "FAILED to write $outFile"
  exit 1
}
