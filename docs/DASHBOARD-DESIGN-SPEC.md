# AGORA Dashboard — デザイン仕様書

## コンセプト: "Control Room"
ターミナルと制御盤の中間。動くものが見える、状態が一目でわかる。ハデさではなく「確かさ」で勝負。

---

## 禁止事項（CLAUDE.md AI Slop リスト）
- ❌ Inter フォント
- ❌ 紫グラデーション
- ❌ 均一な角丸（border-radius: 8px everywhere）
- ❌ 複数色の tint
- ❌ 3枚横並びカード
- ❌ 生の JSON `<pre>` ブロックをメインコンテンツとして使う

---

## カラーパレット

```css
--bg:        #0a0b0d;   /* ほぼ黒 */
--surface:   #111318;   /* カード背景 */
--border:    #1e2128;   /* 区切り線（ヘアライン） */
--text:      #e8eaf0;   /* 本文 */
--muted:     #5a6070;   /* サブテキスト */
--accent:    #e8a020;   /* アンバー — 1色のみ */

/* ステータス（境界線のみ、背景に使わない） */
--healthy:   #2a7a52;
--busy:      #c47a1a;
--failed:    #b03030;
--degraded:  #8a5a20;

/* タイムライン severity */
--sev-info:    #2a4a7a;
--sev-warn:    #c47a1a;
--sev-error:   #b03030;
--sev-success: #2a7a52;
```

---

## タイポグラフィ

```css
font-family: 'JetBrains Mono', 'Cascadia Mono', 'Fira Code', monospace;

/* スケール */
--text-xs:   11px;
--text-sm:   13px;
--text-base: 15px;
--text-lg:   18px;
--text-xl:   28px;   /* AGORA タイトルのみ */

/* ウェイト */
--weight-normal: 400;
--weight-medium: 500;
--weight-bold:   700;
```

---

## レイアウト（2カラム）

```
┌──────────────────────────────────────────────────────┐
│ AGORA                              ● LIVE             │  ← header (48px)
├─────────────────────────┬────────────────────────────┤
│                         │                            │
│   AGENT MESH            │   ACTIVE TASK              │  ← 左右分割
│   (2×3 グリッド)        │   (タスク情報カード)        │
│                         │                            │
│   ─────────────         │   HANDOFF RECEIPT          │
│                         │   (構造化カード)            │
│   CHAOS CONTROLS        │                            │
│   (4ボタン + Reset)     │   TIMELINE                 │
│                         │   (イベントログ)            │
│   ─────────────         │                            │
│   AUTO-REFRESH NOTE     │                            │
│                         │                            │
└─────────────────────────┴────────────────────────────┘
```

---

## Header

```
AGORA                                              ● LIVE
```
- `AGORA`: font-size: 28px, weight: 700, letter-spacing: 0.15em
- `● LIVE`: accent color アンバー、12px、右端
- 下に1pxのヘアライン border-color: var(--border)
- padding: 16px 32px

---

## Agent Card（×6）

**現状の問題**: border色が4種類 + 背景が同じ → 状態が見えにくい

**改善案**: 左側に4px の color strip のみ。背景は全カード同じ。

```
┌─|──────────────────────┐
│  Builder               │  ← label (13px, bold)
│  builder               │  ← role (11px, muted)
│                        │
│  ● FAILED              │  ← status (11px, uppercase, status色)
└────────────────────────┘
```

CSS:
```css
.agent-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 4px solid var(--status-color);  /* 左だけ太い */
  border-radius: 2px;                          /* 鋭め */
  padding: 12px 14px;
}
.status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--status-color);
  display: inline-block;
  margin-right: 6px;
}
```

---

## Chaos Controls

**現状の問題**: 1つの大きな赤ブロック → 何をするか分からない

**改善案**: 小型ボタン、ラベル明確、アイコン付き

```
CHAOS INJECTION
──────────────────────────────────

[ ⚡ Lost Agent ]  [ ⏱ Timeout ]  [ ✗ Bad Output ]  [ ≋ Context Loss ]

                    [ ↺ Reset ]
```

CSS:
```css
.chaos-section h3 {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 10px;
}
.chaos-btn {
  border: 1px solid #5a2020;
  background: transparent;           /* 現状は背景が重い → 透明に */
  color: #e07070;
  font-family: inherit;
  font-size: 12px;
  padding: 7px 12px;
  border-radius: 2px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.chaos-btn:hover {
  border-color: var(--failed);
  color: #f0a0a0;
}
.reset-btn {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  padding: 7px 14px;
  border-radius: 2px;
}
```

---

## Handoff Receipt（構造化表示）

**現状の問題**: 生の JSON `<pre>` → 読めない

**改善案**: key-value カードで重要フィールドを前面に出す。JSON は折りたたみ。

```
HANDOFF RECEIPT
──────────────────────────────────────────────────────────
  failed agent      builder-1
  takeover agent    recovery-1
  failure kind      timeout
  recovery status   reassigned

  completed parts   requirements captured
                    task graph drafted

  failed parts      timeout

  evidence seen     BuilderBase requires failure injection...
                    watchdog observation: builder-1 stopped...
                    shared ledger retained task decomposition...

  [ ▶ view raw JSON ]
──────────────────────────────────────────────────────────
```

CSS のポイント:
```css
.receipt-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
}
.receipt-key { color: var(--muted); font-size: 12px; }
.receipt-val { color: var(--text);  font-size: 13px; }
```

---

## Timeline

**現状**: 縦リスト、左border色分け — これは良い。微調整のみ。

改善点:
- タイムスタンプを `HH:MM:SS` ではなく相対時間 `+0.2s` で表示（インパクト強調）
- 絵文字なし、severity を1文字コードで代替: `I` `W` `E` `✓`

```
TIMELINE
──────────────────
  +0.0s  I  AGORA ledger initialized
  +0.1s  W  watchdog detected timeout on builder-1
  +0.1s  E  Builder status → failed
  +0.1s  I  Recovery Coordinator status → busy
  +0.2s  ✓  handoff receipt issued: builder-1 → recovery-1
  +0.3s  ✓  task completed
──────────────────
```

---

## 実装指示（Codex 向け）

対象ファイル: `src/agora/server.ts` の `renderDashboard()` 関数

変更点:
1. `<style>` ブロックを上記カラーパレット・タイポグラフィ・コンポーネントCSSで全面置き換え
2. Agent card を左 border strip デザインに変更
3. Chaos ボタンを小型化・4分割・透明背景に変更
4. Handoff Receipt を key-value グリッドに変更（生 JSON は折りたたみ `<details>` に）
5. Timeline のタイムスタンプを相対時間表示に変更
6. フォントを `JetBrains Mono` に変更（Google Fonts から読み込み）
7. `Auto-refreshing from /api/state...` のテキストを右下の小さなステータスバーに移動

受け入れ条件:
- Inter フォントが一切残っていない
- 角丸が 2px 以下（または 0）
- 背景色が3種類以内（bg / surface / border）
- アクセント色（アンバー）は LIVE インジケーターと accent 強調にのみ使用
- Chaos ボタンが4つ並んで見える（大きな1ブロックでない）
- Handoff Receipt が key-value 形式で読める
