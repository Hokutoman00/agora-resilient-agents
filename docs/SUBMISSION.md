# AGORA — BuilderBase Submission Text

Copy-paste source for the BuilderBase submission and public project description.

---

## Project name

**AGORA — Adaptive General-purpose Orchestration for Resilient Agents**

---

## Tagline

**When one agent falls, the mesh carries on.**

---

## One-sentence differentiator

**Aegis made individual LLM calls resilient. AGORA makes multi-agent workflows resilient:** shared ledger preserves partial work, Recovery takes over failed agents, Critic revises weak outputs, and Verifier gates completion.

---

## Description

Most AI agent systems fail catastrophically when a single agent crashes mid-task. If a worker agent times out while generating a report, all prior work is lost and the pipeline must restart from scratch.

AGORA introduces **multi-agent coordination resilience**: a shared task ledger, peer watchdog, and handoff receipt system that allows any surviving agent to reconstruct and continue a task from exactly where the failed agent left off, without losing completed work, without restarting, and with a cryptographically verifiable audit trail proving what happened.

AGORA runs an **Agent Mesh** of six specialized roles: Planner, Researcher, Builder, Verifier, Critic, and Recovery Coordinator. Every agent writes progress, evidence, and partial outputs to a shared blackboard. A watchdog continuously monitors agent health and detects failures such as `timeout`, `bad_output`, `lost_agent`, `stale_context`, `contradiction`, `tool_error`, and `human_boundary`.

When a failure is detected:

1. Watchdog marks the failed agent and failure kind.
2. Task state is reconstructed from the shared ledger.
3. Recovery Coordinator resumes from the last known good state.
4. Critic reviews weak outputs before final verification.
5. Verifier gates completion.
6. A signed **Handoff Receipt** records who failed, what was saved, which evidence was used, and how recovery proceeded.

The AGORA dashboard at `localhost:8787` lets judges inject failures and watch the system recover live. The one-click **Judge Demo** deterministically injects a Builder failure, recovers through the shared ledger, runs the Critic loop, records the Verifier gate, and produces a downloadable **Judge Packet** with a 0-100 readiness score.

---

## What makes AGORA different

### 1. Workflow resilience, not just provider resilience

Aegis made single LLM calls resilient through hedging, fallback, and semantic error recovery. AGORA moves one level up: it keeps the whole multi-agent workflow alive when an agent crashes, stalls, loses context, or produces unusable output.

### 2. Handoff Receipt — verifiable recovery proof

Every recovery produces a signed receipt answering the judging questions directly: what failure was introduced, how it was detected, what recovery path was used, and why the final output still works.

### 3. L4 catches what every gateway misses

AGORA inherits Aegis's L4 semantic error fallback. Anthropic's `400 credit_balance_too_low` error is treated as fallback-eligible even when ordinary gateway status-code fallback would pass it through. That closes a concrete production failure mode for agent systems.

### 4. Critic + Verifier loop

AGORA does not simply restart after failure. It uses a Critic to review weak Builder outputs, asks Builder to revise, then uses Verifier as the final quality gate.

### 5. Honest integration labeling

AGORA uses TrueFoundry AI Gateway when configured. MCP Gateway and Guardrail evidence are included as local-compatible audit and simulation evidence unless the required live tenant scopes are available. The submission avoids overstating live connectivity.

---

## Built with

```text
TypeScript · Bun · Hono · TrueFoundry AI Gateway · AWS Bedrock-compatible routing
Agent Mesh · Shared Ledger · Watchdog · Critic Loop · Handoff Receipt
MCP Tool Audit · Local Guardrail Checks · AIVS-style signed evidence
```

---

## Try it out

- **GitHub**: https://github.com/Hokutoman00/agora-resilient-agents
- **Demo video**: https://youtu.be/Tdg8QEwAHXw
- **Dashboard**:

```bash
bun install
bun start
# open http://localhost:8787
```

Then click **Judge Demo** to generate the recovery proof and judge packet.

---

## Verification

Latest local verification:

- `bun run typecheck` — pass
- `bun test` — 105 pass / 0 fail
- `secret-preflight-scan agora-mvp` — pass
- `demo/final-assets/judge-packet.json` — generated
- `demo/final-assets/agora-dashboard-judge-demo.png` — generated

---

## Submission record

- BuilderBase submission status: `final`
- BuilderBase submission ID: `34a8b642`
- GitHub URL: https://github.com/Hokutoman00/agora-resilient-agents
- Demo video URL: https://youtu.be/Tdg8QEwAHXw

---

## Team

Hokuto Torigoe — solo developer, with Claude + Codex collaboration through the NEXUS coordination board.
