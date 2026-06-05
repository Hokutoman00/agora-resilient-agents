# AGORA — デモ動画脚本（90秒）

## 録画前準備
1. http://localhost:8787 をブラウザで開く
2. 「Reset」ボタンを押して全エージェントを HEALTHY に戻す
3. 画面録画を開始（1920×1080 推奨）

---

## 0:00–0:15 — オープニング（ナレーション）

> "Aegis made individual LLM calls resilient. AGORA makes multi-agent workflows resilient."

> "Most AI agent systems fail completely when one agent crashes mid-task.
> AGORA doesn't."

**操作**: ダッシュボードを見せる（全エージェント HEALTHY 状態）

---

## 0:15–0:30 — タスク実行開始

> "We give AGORA a real business task through the TrueFoundry AI Gateway path."

**操作**: 「Run Task」ボタンをクリック（default task または "Provider Outage Impact" プリセット）

**画面**: Researcher → BUSY（黄色）になる

> "When a TrueFoundry key is configured, the LLM Gateway call is live. The rest of the demo keeps the same evidence fields and labels any local simulation honestly."

---

## 0:30–0:45 — Chaos 注入（ハイライト）

**操作**: Chaos Indicator が **READY** になったら「Rate Limit Exceeded」ボタンをクリック

> "Rate limit hit — Builder fails mid-task."

**画面**: 
- Builder → FAILED（赤）
- `Chaos window open` イベントが timeline に出現
- Recovery Coordinator → BUSY（橙）

> "Watchdog detects it. Recovery Coordinator reconstructs from the shared ledger."

---

## 0:45–1:10 — 回復の証明

**画面**: タスクが `recovered` で完了

> "The Handoff Receipt proves exactly what happened:"

**操作**: Handoff Receipt エリアをズームイン

> "• Failure: rate_limit
> • Gateway mode: live when configured, simulation otherwise
> • MCP and Guardrail evidence: local-compatible audit unless TrueFoundry endpoints are configured
> • Research preserved: 1,500 characters from the shared ledger"

**画面**: Timeline を下にスクロール

> "And the Critic agent reviewed Builder's draft before Verifier signed off."

---

## 1:10–1:30 — 品質証明

**画面**: Verdict セクション

> "Verifier rubric: completeness 10, coherence 10, usefulness 10 — pass.
> The user deliverable was preserved. Not degraded. Proven."

**操作**: Judging Evidence の TF Gateway / MCP Tool Policy / Guardrail 行を見せる

> "TrueFoundry LLM Gateway integration, local-compatible MCP and Guardrail audits, and a real agent-recovery path. No hidden restart. No fake success."

---

## 1:30 — エンディング

> "AGORA: when one agent falls, the mesh carries on."

**画面**: GitHub URL を表示
`https://github.com/Hokutoman00/agora-resilient-agents`

---

## 録画メモ
- 解像度: 1920×1080
- 音声: ナレーション（録音）または字幕のみでも可
- YouTube: 限定公開でアップロードし、URL を BuilderBase フォームに貼付
- 総尺: 90秒以内が理想（最大 3 分）
