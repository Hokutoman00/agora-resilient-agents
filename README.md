# AGORA — Adaptive General-purpose Orchestration for Resilient Agents

[![Hackathon](https://img.shields.io/badge/TF_Resilient_Agents-Online_Hackathon_2026-blue)](https://www.builderbase.com/v2/event/resilient-agents-online-hackathon)
[![Challenge](https://img.shields.io/badge/TrueFoundry-Resilient_Agents_Online-orange)](https://www.builderbase.com/v2/event/resilient-agents-online-hackathon)
[![Tests](https://img.shields.io/badge/tests-105%20passing-brightgreen)](./tests/unit)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

> **When one agent falls, the mesh carries on.**

**Aegis made individual LLM calls resilient. AGORA makes multi-agent workflows resilient:** shared ledger preserves partial work, Recovery takes over failed agents, Critic revises weak outputs, and Verifier gates completion.

## Why AGORA exists — the two layers of resilience

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1 — Provider Resilience (Aegis, 1st place DevNetwork)   │
│                                                                 │
│  User → TrueFoundry AI Gateway → AWS Bedrock                   │
│          └─ L0 Hedge ─ L1 Retry ─ L2 Model fallback ─         │
│             L3 Provider fallback ─ L4 Semantic error ─         │
│             L5 Graceful degradation ─ L6 Continuous chaos       │
│                                                                 │
│  Handles: rate limits, model outages, provider failures         │
│  Proof: Aegis Receipt (signed, per-layer trace)                 │
└─────────────────────────────────────────────────────────────────┘
         ↓  Even with L1-L6, an individual agent can still fail
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2 — Workflow Resilience (AGORA, this submission)        │
│                                                                 │
│  Planner → Researcher → Builder ←───── Watchdog               │
│                            ↕ debate (2 rounds)                 │
│                           Critic                               │
│                    (issues / guidance)                         │
│                            ↓                                   │
│                         Shared Ledger (context survives)        │
│                            ↓                                   │
│                    Recovery Coordinator                         │
│                            ↓                                   │
│                  Verifier (rubric quality gate)                 │
│                                                                 │
│  Handles: agent crashes, task stalls, bad outputs              │
│  Proof: Handoff Receipt (who failed, what was saved, how)      │
└─────────────────────────────────────────────────────────────────┘
```

**AGORA extends [Aegis](https://devpost.com/software/aegis-resilient-agents)** (1st place, DevNetwork AI+ML 2026 TrueFoundry track) from single-agent API resilience to multi-agent workflow resilience. When a worker agent fails mid-task — even after TF Gateway has already done its job — AGORA's watchdog detects it, reconstructs the task state from the shared ledger, and hands off to a recovery agent without losing completed work. Every recovery is proven by a signed **Handoff Receipt** containing TF Gateway evidence (`gateway_mode`, `fallback_triggered`, `model_used`).

Built on **TrueFoundry AI Gateway** + **AWS Bedrock**.

---

## The two resilience layers

### Layer 1 — API resilience (inherited from Aegis, 7 sub-layers)

| Sub-layer | Job | Owner |
|------:|---|---|
| **L0** | **Hedge** parallel requests on TTFT > p95 | AGORA |
| **L1** | **Retry** with exponential backoff + jitter | TF Gateway |
| **L2** | **Model fallback** within provider | TF Virtual Model |
| **L3** | **Provider fallback** across providers | TF Virtual Model |
| **L4** | **Semantic error fallback** — catches `credit_balance_too_low` (400) that gateways miss | AGORA |
| **L5** | **Graceful degradation contract** — budget / SLA / quality | AGORA |
| **L6** | **Continuous self-chaos** in shadow | AGORA |

### Layer 2 — Multi-agent coordination resilience (new in AGORA)

| Component | Job |
|---|---|
| **Agent Mesh** | 6 specialized agents: Planner / Researcher / Builder / Verifier / Critic / Recovery Coordinator |
| **Shared Blackboard** (Task Ledger) | Agents write progress, evidence, and partial results to a shared ledger — context survives any single agent dying |
| **Watchdog** | Continuously monitors agent health; detects timeout / bad\_output / lost\_agent / stale\_context |
| **Recovery Engine** | On failure: reconstruct task state from ledger → reassign to Recovery Coordinator → resume |
| **MCP Tool Audit** | Classifies read/write tool calls, records `READ_HEDGE` / `WRITE_TIED` policy, and stores tool evidence in the ledger |
| **Handoff Receipt** | Signed record of who failed, what was completed, what evidence was seen, and how recovery proceeded |
| **Failure Taxonomy** | `timeout` / `bad_output` / `contradiction` / `stale_context` / `tool_error` / `lost_agent` / `human_boundary` |

---

## The differentiator AGORA inherits: L4 catches what every gateway misses

```
[2026-05-10 02:18:32]  user → AGORA → TF Virtual Model "claude-with-fallback"
[AGORA L0]             hedge fired (p95 = 1.5s exceeded)
[TF L1/L2]             anthropic/claude-sonnet-4.5 → 400 credit_balance_too_low
[TF L3]                fallback codes [401,403,...,503] don't include 400 → pass-through
[AGORA L4]             error.type=invalid_request_error + message="credit balance"
                       → reclassified as fallback-eligible
                       → routed to openai/gpt-4.1
[OpenAI]               200 OK, 320ms TTFT
[AGORA L0]             cancel hedge (cost saved: ~$0.0001)
[Handoff Receipt]      attached to response
```

`credit_balance_too_low` is what brings down most LLM apps the moment a credit card expires. LiteLLM, OpenRouter, and TrueFoundry's default fallback all silently pass it through ([LiteLLM issue #24320](https://github.com/BerriAI/litellm/issues/24320)). AGORA catches it.

---

## Live demo — 30 seconds to prove resilience

```bash
bun install
bun start          # http://localhost:8787
```

Open the dashboard, then click any chaos button:

| Button | Failure injected | What AGORA does | Proof |
|---|---|---|---|
| **Provider Outage** | Builder agent disappears | Watchdog detects → Recovery Coordinator takes over | Handoff Receipt: `failureKind: lost_agent` |
| **Rate Limit Exceeded** | Builder agent times out | Watchdog detects stall → task state reconstructed from ledger | Handoff Receipt: `failureKind: timeout` |
| **Malformed Response** | Builder produces invalid output | Verifier rejects → Critic flags → replanned | Handoff Receipt: `failureKind: bad_output` |
| **Context Window Exceeded** | Builder loses conversation history | Ledger replay restores context | Handoff Receipt: `failureKind: stale_context` |
| **Reset** | Restore all agents to healthy | — | Dashboard returns to green |

For judging, click **Judge Demo** once. It deterministically injects a Builder failure, recovers through the shared ledger, runs the Critic loop, records the Verifier gate, and produces a downloadable **Judge Packet** with a 0-100 readiness score.

The dashboard auto-refreshes every 1.5 seconds. No page reload needed.

### What the gateway evidence proves

AGORA records the gateway evidence separately from the agent-recovery evidence. In a configured live run, `gateway_mode: "live"` means the request reached TrueFoundry AI Gateway. In the deterministic Judge Demo, recovery, MCP audit, and Guardrail evidence are intentionally labeled as local/simulation evidence unless the corresponding TrueFoundry endpoint is configured. The current submission does not claim live TrueFoundry MCP Gateway or live TrueFoundry Guardrails access when those account scopes are unavailable.

```json
"gateway": {
  "gateway_mode": "live",
  "model_used": "vahana-virtual-model/vahana-virtual-model",
  "fallback_triggered": true
}
```

---

## Architecture

```
User Request
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  AGORA Control Plane                                 │
│                                                     │
│  Planner ──► Researcher ──► Builder ──► Verifier    │
│      │           │              │           │        │
│      └───────────┴──────────────┴───────────┘        │
│                       │                             │
│               Shared Blackboard                     │
│            (Task Ledger + Events)                   │
│                       │                             │
│              Watchdog (health monitor)              │
│                       │ (on failure)                │
│              Recovery Coordinator                   │
│                       │                             │
│              Handoff Receipt ◄── Critic             │
└─────────────────────────────────────────────────────┘
    │
    ▼
TrueFoundry AI Gateway / Virtual Model (live when configured)
    + local-compatible MCP audit and Guardrail checks
```

---

## Verify in 5 minutes

```bash
bun install
bun test                                # 105 tests, 0 fail
bun run src/agora/demo.ts               # full handoff receipt printed to stdout
bun start                               # live dashboard at http://localhost:8787
bun run examples/bedrock-demo.ts        # end-to-end L4 + Bedrock demo
```

AGORA ships **5 verified improvements** over the current industry baseline:

| ID | Improvement | Source |
|---|---|---|
| **C1** | AWS Bedrock `bedrock-runtime` vs `bedrock-mantle` endpoint split + throttle classification | AWS Bedrock release 2026-05-27 |
| **C3** | ListSpans-aware Guardrail Receipt — per-policy assessment on `GuardrailIntervention` | AWS Bedrock release 2026-05-22 |
| **C4** | MCP STDIO transport quarantine (CVSS 9.8 RCE) + TOFU origin pin | CVE 2026-04, ~200K servers affected |
| **C5** | AGORA run-level MCP tool audit — `search_outage_signals` is classified as `READ_HEDGE` and recorded in the task ledger | AGORA verified test |
| **C6** | AIVS-format signed Handoff Receipt (Ed25519 + SHA-256 hash chain) | IETF draft-stone-aivs-00 |

---

## Quick start

```bash
bun install
cp .env.example .env.local
# fill in TRUEFOUNDRY_API_KEY from https://app.truefoundry.com

bun start          # AGORA dashboard: http://localhost:8787
bun run dev        # development mode with hot reload
```

### API endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | AGORA dashboard (HTML) |
| `GET` | `/api/state` | current agent mesh state (JSON) |
| `POST` | `/api/chaos/:kind` | inject failure: `lost_agent` / `timeout` / `bad_output` / `stale_context` |
| `POST` | `/api/demo/recovery` | one-call judge demo: inject failure → recover → critique → verify |
| `GET` | `/api/judge-packet` | current judge-ready scorecard and evidence packet (JSON) |
| `GET` | `/health` | uptime probe |
| `POST` | `/v1/chat/completions` | OpenAI-compat chat (stream + non-stream) with full L0-L6 resilience |

---

## Tech stack

- **Runtime**: [Bun](https://bun.sh) (≥1.3) + TypeScript (strict)
- **Server**: [Hono](https://hono.dev/)
- **LLM routing**: TrueFoundry AI Gateway / Virtual Model path, with AWS Bedrock-compatible provider routing
- **Agent coordination**: Custom AGORA Agent Mesh (Task Ledger + Watchdog + Handoff Receipt)
- **Guardrails**: TrueFoundry-compatible local `localInputCheck` on all agent inputs and outputs — blocks unsafe content, degrades task status when blocked, and is labeled local/simulation unless live TrueFoundry Guardrails credentials are available
- **MCP Gateway**: every AGORA run now records an MCP tool audit artifact (`mcp_tool_audit`) using the same `READ_HEDGE` / `WRITE_TIED` classifier and hedge policy used by the `/v1/mcp/call` API. When `TRUEFOUNDRY_MCP_ENDPOINT` is configured, the artifact marks the endpoint as configured; otherwise it is explicitly labeled simulation rather than falsely claiming live TF MCP Gateway usage.
- **Chaos**: Chaos buttons (deterministic) + [Toxiproxy](https://github.com/Shopify/toxiproxy) (network-level)
- **Observability**: TrueFoundry AI Monitoring (OTel-compatible)
- **Lint/format**: [Biome](https://biomejs.dev/)

---

## Hackathon submission

| Field | Detail |
|---|---|
| Hackathon | [Resilient Agents - Online Hackathon](https://www.builderbase.com/v2/event/resilient-agents-online-hackathon) |
| Organizer | TrueFoundry × AWS Bedrock |
| Submission deadline | 2026-06-08 15:30 UTC |
| Team | Solo — Hokuto Torigoe |

## Acknowledgments

TrueFoundry for sponsoring the challenge. Sai Krishna (TF DevRel) for clarifying that direct Gateway integration is Criteria #1. The [LiteLLM issue #24320 thread](https://github.com/BerriAI/litellm/issues/24320) for documenting the industry-wide `credit_balance_too_low` gap that AGORA L4 closes.

## License

MIT — see [LICENSE](./LICENSE).
