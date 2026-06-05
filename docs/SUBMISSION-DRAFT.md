# AGORA — BuilderBase 提出草案

## Project Name
AGORA — Adaptive General-purpose Orchestration for Resilient Agents

## Tagline
When one agent falls, the mesh carries on.

## What problem does it solve?

Most AI agent systems fail catastrophically when a single agent crashes mid-task. If a worker agent times out while generating a report, all prior work is lost and the pipeline must restart from scratch.

AGORA introduces **multi-agent coordination resilience**: a shared task ledger, peer watchdog, and handoff receipt system that allows any surviving agent to reconstruct and continue a task from exactly where the failed agent left off — without losing completed work, without restarting, and with a cryptographically-verifiable audit trail proving what happened.

## How it works

AGORA runs an **Agent Mesh** of 6 specialized roles: Planner, Researcher, Builder, Verifier, Critic, and Recovery Coordinator. Every agent writes its progress to a **Shared Blackboard** (Task Ledger). A **Watchdog** continuously monitors all agents and detects failures by type: `timeout`, `bad_output`, `lost_agent`, `stale_context`, `contradiction`, `tool_error`.

When a failure is detected:
1. Watchdog fires, marks the agent as failed
2. Task state is reconstructed from the shared ledger (no work is lost)
3. Recovery Coordinator is assigned and resumes from the last known good state
4. A **Handoff Receipt** is generated — a signed record of who failed, what was completed, what evidence was seen, and what recovery path was taken

The AGORA Dashboard at `localhost:8787` shows this process live with 1.5-second polling. Judges can click **Lost Agent**, **Timeout**, **Bad Output**, or **Context Loss** to inject failures and watch the recovery proof appear in real time.

## What makes AGORA different

**1. Failure taxonomy, not just "agent failed"**
AGORA classifies 7 failure modes and routes each to the appropriate recovery path. A `timeout` is handled differently from `bad_output`, which is different from `stale_context`. Most systems treat all failures as "restart."

**2. Handoff Receipt — verifiable recovery proof**
Every recovery produces a signed receipt answering the four questions BuilderBase requires: what failure was introduced, how it was detected, what recovery path was used, and why the final output still works. Judges can verify each receipt independently.

**3. L4 catches what every gateway misses**
AGORA inherits Aegis's L4 semantic error fallback: Anthropic's `400 credit_balance_too_low` error is silently passed through by LiteLLM, OpenRouter, and TrueFoundry's default Virtual Model fallback (documented in [LiteLLM issue #24320](https://github.com/BerriAI/litellm/issues/24320)). AGORA reclassifies it as fallback-eligible and routes to the next provider. This closes an industry-wide production gap.

**4. Real architecture — not a demo**
The Claude + Codex collaborative development system used to build AGORA runs on the same shared-ledger + peer-watchdog architecture. AGORA is a productized version of the system its own authors use daily.

## Tech stack

- **TrueFoundry AI Gateway** — LLM routing, fallback, and observability (required)
- **AWS Bedrock** — model access (Claude, Titan, Llama via Bedrock)
- **TrueFoundry MCP Gateway** — controlled tool access with Guardrails
- **Bun + TypeScript** — runtime (strict mode, 101 tests passing)
- **Hono** — dashboard server
- **Custom Agent Mesh** — Task Ledger (SQLite-backed), Watchdog, Handoff Receipt engine

## GitHub
https://github.com/Hokutoman00/agora-resilient-agents *(to be created)*

## Demo video
*(to be recorded)*

## Team
Solo — Hokuto Torigoe

## Submission deadline
2026-06-08 15:30 UTC
