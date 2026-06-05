# AGORA — Real LLM Agent 実装仕様書

## 目標
エージェントが実際に TrueFoundry AI Gateway 経由で Claude を呼び出し、
本物のタスクを実行しながら障害から回復することを証明する。

---

## アーキテクチャ

```
POST /api/run { task: "量子コンピューティングの最新動向を調べてまとめて" }
        │
        ▼
  [runner.ts] ── Planner: タスクを研究/構築/検証の3ステップに分解
        │
        ├─ Step 1: Researcher → TF Gateway → Claude → 調査結果 (bullet points)
        │            ↓ 保存: ledger.saveArtifact('research', content)
        │
        ├─ Step 2: Builder → TF Gateway → Claude → レポート生成
        │            ↓ ここで Chaos ボタンが有効
        │            ↓ timeout/lost_agent 注入 → Watchdog 検知
        │            ↓ RecoveryCoordinator: ledger から research を復元
        │            ↓ RecoveryCoordinator → TF Gateway → Claude → 続きを生成
        │            ↓ 保存: ledger.saveArtifact('report', content)
        │
        └─ Step 3: Verifier → TF Gateway → Claude → 品質確認
                     ↓ 保存: ledger.saveArtifact('verdict', content)

GET /api/result/:runId → { status, artifacts, receipts, events }
```

---

## デュアルモード（重要）

```ts
const LIVE_MODE = !!process.env.TRUEFOUNDRY_API_KEY?.trim();
```

- **LIVE_MODE = true**: 実際に TF Gateway → Claude を呼ぶ
- **LIVE_MODE = false**: リアルなモックレスポンス（API キーなしでもデモ可）

ダッシュボードのヘッダーに `● LIVE (TF Gateway)` または `○ SIMULATION` を表示する。

---

## 新規ファイル

### `src/agora/agents/researcher.ts`

```ts
import { getTFClient, getDefaultVirtualModel } from '../../aegis/tf-client.js';

const MOCK_RESEARCH = `
- 2026年Q1: Google Willow チップが誤り訂正で量子優位性を実証（Nature 掲載）
- IBM Heron: 133量子ビット、エラー率 0.1% 未満を達成
- Microsoft Topological Qubit: 2026-02 に物理的実証を発表（Physical Review Letters）
- 量子誤り訂正: Surface Code が商用スケールで初めて動作
- 実用化予測: 金融/創薬での量子アドバンテージは 2028-2030 と多くの研究者が予測
`.trim();

export async function runResearcher(topic: string): Promise<string> {
  if (!process.env.TRUEFOUNDRY_API_KEY?.trim()) return MOCK_RESEARCH;

  const client = getTFClient();
  const res = await client.chat.completions.create({
    model: getDefaultVirtualModel(),
    messages: [
      {
        role: 'system',
        content: 'You are a Research Agent. Given a topic, produce 5-7 specific, factual bullet points about recent developments. Be concise.',
      },
      { role: 'user', content: `Research topic: ${topic}` },
    ],
    max_tokens: 400,
  });
  return res.choices[0]?.message?.content ?? MOCK_RESEARCH;
}
```

### `src/agora/agents/builder.ts`

```ts
import { getTFClient, getDefaultVirtualModel } from '../../aegis/tf-client.js';

export async function runBuilder(research: string, partialReport?: string): Promise<string> {
  const MOCK = partialReport
    ? `${partialReport}\n\n[Recovery Coordinator が引き継ぎ、レポートを完成させました]\n\n今後の展望として、量子コンピューティングは2028年までに金融・創薬分野での実用化が見込まれます。`
    : `量子コンピューティング最新動向レポート\n\n${research.split('\n').slice(0, 3).join('\n')}\n\n詳細な分析と今後の展望...`;

  if (!process.env.TRUEFOUNDRY_API_KEY?.trim()) return MOCK;

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
  return res.choices[0]?.message?.content ?? MOCK;
}
```

### `src/agora/agents/verifier.ts`

```ts
import { getTFClient, getDefaultVirtualModel } from '../../aegis/tf-client.js';

export async function runVerifier(report: string): Promise<string> {
  const MOCK = '✓ レポートは正確で構造的に完成しています。障害からの回復にもかかわらず、内容の一貫性が保たれています。';

  if (!process.env.TRUEFOUNDRY_API_KEY?.trim()) return MOCK;

  const client = getTFClient();
  const res = await client.chat.completions.create({
    model: getDefaultVirtualModel(),
    messages: [
      { role: 'system', content: 'You are a Verifier Agent. Check if this report is coherent, accurate, and complete. Reply in 1-2 sentences.' },
      { role: 'user', content: report },
    ],
    max_tokens: 150,
  });
  return res.choices[0]?.message?.content ?? MOCK;
}
```

### `src/agora/runner.ts`

```ts
import { TaskLedger } from './ledger.js';
import { runResearcher } from './agents/researcher.js';
import { runBuilder } from './agents/builder.js';
import { runVerifier } from './agents/verifier.js';
import { buildHandoffReceipt } from './handoff-receipt.js';
import type { FailureKind } from './types.js';

export type RunResult = {
  runId: string;
  topic: string;
  status: 'completed' | 'failed' | 'recovered';
  artifacts: { research?: string; report?: string; verdict?: string };
  ledger: ReturnType<TaskLedger['snapshot']>;
};

// グローバル台帳（デモ用。本番は runId ごとに分離）
export const activeLedger = new TaskLedger();
let pendingChaos: FailureKind | null = null;

export function setPendingChaos(kind: FailureKind) {
  pendingChaos = kind;
}

export async function runAgentTask(topic: string): Promise<RunResult> {
  const runId = `run-${Date.now()}`;
  const artifacts: RunResult['artifacts'] = {};
  
  // Reset ledger for new run
  activeLedger.reset();
  activeLedger.event('info', `Task started: ${topic}`, 'planner-1', 'task-agora-demo', 'task');

  // Step 1: Research
  activeLedger.markAgent('researcher-1', 'busy', 'task-agora-demo');
  activeLedger.event('info', 'Researcher starting...', 'researcher-1', 'task-agora-demo');
  const research = await runResearcher(topic);
  activeLedger.saveArtifact('task-agora-demo', 'researcher-1', 'research', research);
  activeLedger.markAgent('researcher-1', 'healthy');
  activeLedger.event('success', 'Research complete', 'researcher-1', 'task-agora-demo');
  artifacts.research = research;

  // Step 2: Build (chaos injection point)
  activeLedger.markAgent('builder-1', 'busy', 'task-agora-demo');
  activeLedger.event('info', 'Builder synthesizing report...', 'builder-1', 'task-agora-demo');

  let report: string;
  const chaos = pendingChaos;
  pendingChaos = null;

  if (chaos) {
    // Inject failure mid-task
    activeLedger.event('warn', `Chaos injected: ${chaos} on builder-1`, 'recovery-1', 'task-agora-demo', 'watchdog');
    activeLedger.markAgent('builder-1', 'failed', 'task-agora-demo');
    
    const task = activeLedger.snapshot().tasks.find(t => t.id === 'task-agora-demo')!;
    const receipt = buildHandoffReceipt({
      failedAgentId: 'builder-1',
      takeoverAgentId: 'recovery-1',
      task,
      failureKind: chaos,
      evidenceSeen: [
        `Research artifact preserved in shared ledger (${research.length} chars)`,
        `Watchdog detected ${chaos} on builder-1`,
        'Recovery Coordinator reconstructing task from ledger',
      ],
    });
    activeLedger.applyReceipt(receipt);

    // Recovery: use saved research to continue
    activeLedger.markAgent('recovery-1', 'busy', 'task-agora-demo');
    activeLedger.event('info', 'Recovery Coordinator resuming from ledger...', 'recovery-1', 'task-agora-demo');
    report = await runBuilder(research, ''); // empty partial → full recovery
    activeLedger.saveArtifact('task-agora-demo', 'recovery-1', 'report', report);
    activeLedger.markAgent('recovery-1', 'healthy');
    activeLedger.event('success', 'Recovery complete. Report generated.', 'recovery-1', 'task-agora-demo');
    artifacts.report = report;
  } else {
    report = await runBuilder(research);
    activeLedger.saveArtifact('task-agora-demo', 'builder-1', 'report', report);
    activeLedger.markAgent('builder-1', 'healthy');
    activeLedger.event('success', 'Report generated', 'builder-1', 'task-agora-demo');
    artifacts.report = report;
  }

  // Step 3: Verify
  activeLedger.markAgent('verifier-1', 'busy', 'task-agora-demo');
  const verdict = await runVerifier(report);
  activeLedger.saveArtifact('task-agora-demo', 'verifier-1', 'verdict', verdict);
  activeLedger.markAgent('verifier-1', 'healthy');
  activeLedger.event('success', `Verification: ${verdict.slice(0, 60)}...`, 'verifier-1', 'task-agora-demo');
  artifacts.verdict = verdict;

  activeLedger.complete('task-agora-demo', 'All stages completed');

  return {
    runId,
    topic,
    status: chaos ? 'recovered' : 'completed',
    artifacts,
    ledger: activeLedger.snapshot(),
  };
}
```

---

## 更新ファイル

### `src/agora/types.ts` への追加

```ts
// TaskRecord に追加:
artifacts?: Record<string, string>;  // agentId -> content
```

### `src/agora/ledger.ts` へのメソッド追加

```ts
saveArtifact(taskId: string, agentId: string, key: string, value: string): void {
  const task = this.task(taskId);
  if (!task.artifacts) task.artifacts = {};
  task.artifacts[`${agentId}:${key}`] = value;
  const preview = value.slice(0, 60).replace(/\n/g, ' ');
  this.event('info', `Artifact saved: ${key} (${value.length} chars) — "${preview}..."`, agentId, taskId, 'artifact');
}

complete(taskId: string, summary: string): void {
  const task = this.task(taskId);
  task.status = 'completed';
  task.completedParts.push(summary);
  task.updatedAt = now();
  this.event('success', `task completed: ${summary}`, undefined, taskId, 'task');
}
```

### `src/agora/server.ts` への追加

```ts
import { runAgentTask, setPendingChaos, activeLedger } from './runner.js';

// 既存の /api/chaos/:kind を更新:
app.post('/api/chaos/:kind', async c => {
  const kind = c.req.param('kind') as FailureKind;
  setPendingChaos(kind);  // 次のタスク実行時に注入
  activeLedger.event('warn', `Chaos armed: ${kind}`, 'watchdog', undefined, 'watchdog');
  return c.json({ ok: true, armed: kind, state: activeLedger.snapshot() });
});

// 新規エンドポイント:
app.post('/api/run', async c => {
  const body = await c.req.json<{ task?: string }>();
  const topic = body.task ?? '量子コンピューティングの2026年最新動向';
  const result = await runAgentTask(topic);
  return c.json(result);
});

app.get('/api/state', c => c.json(activeLedger.snapshot()));
```

### Dashboard の更新（server.ts の renderDashboard）

- タスクカードに `artifacts` セクションを追加
  - `research` の最初の3行をプレビュー表示
  - `report` を折りたたみ可能な全文表示
  - `verdict` を1行で表示
- "Run Task" ボタンを追加（POST /api/run を呼ぶ）
- ヘッダーに `● LIVE` / `○ SIMULATION` モード表示

---

## デモの流れ（これで審査4点セットが全部揃う）

```
1. "Run Task" ボタン → 実際の LLM がリサーチを実行
2. Research アーティファクトが台帳に保存される
3. "Timeout" ボタン → Builder が失敗
4. Watchdog が検知 → Recovery Coordinator が台帳から research を復元
5. Recovery Coordinator が LLM を呼んでレポートを完成
6. Verifier が検証
7. Handoff Receipt に: 「何が失敗したか」「何が保存されていたか」「どう回復したか」が記載
8. 最終レポートが画面に表示される → 「なぜユーザー体験が維持されたか」が証明される
```

---

## 実装優先順位（Codex）

1. `types.ts` に `artifacts` フィールド追加
2. `ledger.ts` に `saveArtifact()` / `complete()` メソッド追加
3. `agents/researcher.ts` 作成
4. `agents/builder.ts` 作成
5. `agents/verifier.ts` 作成
6. `runner.ts` 作成
7. `server.ts` に `/api/run` 追加 + chaos を "arm" 方式に変更
8. Dashboard に artifacts 表示 + "Run Task" ボタン + LIVE/SIMULATION インジケーター追加
9. `bun test` で全テスト確認
