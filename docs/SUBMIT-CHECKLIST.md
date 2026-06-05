# AGORA — BuilderBase 提出チェックリスト

締切: **2026-06-08 15:30 UTC**（日本時間 6/9 00:30）
提出先: https://app.builderbase.com/v2/event/resilient-agents-online-hackathon

---

## Claude 担当（事前準備）

- [x] README.md → AGORA にリブランド完了
- [x] SUBMISSION-DRAFT.md 作成（提出文面草案）
- [x] DASHBOARD-DESIGN-SPEC.md 作成（Codex に渡し済み）
- [ ] DEMO-SCRIPT.md → AGORA 版に更新
- [ ] GitHub リポジトリ作成・公開（`Hokutoman00/agora-resilient-agents`）
- [ ] git init → push

## Codex 担当（実装）

- [x] agora-mvp/ コア実装（ledger / watchdog / handoff-receipt）
- [x] Dashboard server（port 8787）
- [x] 4種類の Chaos ボタン + Reset + 自動ポーリング
- [x] bun test 101 pass
- [ ] ダッシュボード フルリデザイン（DASHBOARD-DESIGN-SPEC.md 参照）

## ユーザー担当（手作業必須）

### 1. デモ動画録画・YouTube アップロード（~15分）
- [ ] http://localhost:8787 を開く
- [ ] Reset → Timeout ボタンの順に操作しながら画面録画（30秒〜1分）
- [ ] Lost Agent シナリオも録画
- [ ] YouTube Studio にアップロード（限定公開）
  - タイトル: `AGORA — Adaptive General-purpose Orchestration for Resilient Agents`
  - 説明: SUBMISSION-DRAFT.md の内容を貼り付け
- [ ] YouTube URL をメモ

### 2. BuilderBase に提出（~10分）
URL: https://app.builderbase.com/v2/event/resilient-agents-online-hackathon

| 項目 | 内容 |
|---|---|
| Project Name | AGORA — Adaptive General-purpose Orchestration for Resilient Agents |
| Tagline | When one agent falls, the mesh carries on. |
| Description | SUBMISSION-DRAFT.md の内容 |
| GitHub URL | https://github.com/Hokutoman00/agora-resilient-agents |
| Demo Video | YouTube URL（手順1で取得） |
| Track | Resilient Agents - Online Hackathon |

### 3. 確認
- [ ] 提出完了メールが届いたか確認
- [ ] BuilderBase のプロジェクトページで表示されるか確認

---

## 注意事項

- GitHub リポジトリは**公開（public）**にする
- `.env` / API キーがコミットされていないことを確認（gitignore 済み）
- 動画は**限定公開**（Unlisted）でよい（URLを知っている人は見られる）
