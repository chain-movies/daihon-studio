# Claude Code ⇄ Obsidian 記憶ブリッジ

Claude Code でやった作業を **自動で Obsidian に記録**し、次に指示を出すときに
**Obsidian から過去の記憶をたどって**作業させるための仕組み。

- 書く側: Claude Code のフックが、セッションのたびに Vault へ Markdown を書き出す
- 読む側: セッション開始時と、あなたが指示を出すたびに、関連する過去ノートを自動で読み込む
- 明示操作: `/recall`（思い出す）、`/remember`（覚えさせる）

Python 3.8+ の標準ライブラリだけで動く。外部サービスには一切送信しない（全部ローカルのファイル操作）。

---

## 1. できること

| タイミング | 起きること |
|---|---|
| セッション開始 | そのフォルダの「プロジェクトノート（前提・決定事項）」と直近3セッションの要約を自動で読み込む |
| あなたが指示を出すたび | 指示文で Vault を全文検索し、関連の強いノート最大3件を自動で読み込む |
| ファイル編集 / コマンド実行 | 変更ファイルと実行コマンドをセッションノートに追記（APIキー等は伏字） |
| 応答の終わり | 最後の回答を「まとめ」としてノートに保存 |
| セッション終了 | プロジェクトノートの履歴とデイリーノートにリンクを追記 |
| `/recall 〜` | Obsidian を検索して該当ノートを読み込ませる |
| `/remember 〜` | 決定事項をプロジェクトノートに永続化（次回以降ずっと効く） |

## 2. Vault にできる構造

```
<Vault>/
├── ClaudeCode/
│   ├── Projects/
│   │   └── daihon-studio.md          … 記憶の入口。前提・決定事項 + セッション履歴
│   └── Sessions/
│       └── 2026-09/
│           └── 2026-09-06 1150 daihon-studio a1b2c3.md
└── Daily/
    └── 2026-09-06.md                 … その日のセッションへのリンク（既存のデイリーノートに追記）
```

セッションノートの中身:

````markdown
---
type: claude-session
project: "daihon-studio"
cwd: "/Users/you/daihon-studio"
date: 2026-09-06
tags: ["claude-code", "claude-code/daihon-studio"]
---

# 2026-09-06 1150 daihon-studio

プロジェクト: [[ClaudeCode/Projects/daihon-studio|daihon-studio]]

## まとめ
sw.js のキャッシュ名を v3 に上げました。

## 指示（あなたが言ったこと）
- **2026-09-06T11:50** PWAの更新が反映されないのを直したい

## 変更したファイル
- `sw.js` — 編集（1回）

## 実行したコマンド
```sh
git status
```

<!-- claude-memory:auto-end / この行より下は自由に編集して構いません -->
````

**重要**: `claude-memory:auto-end` より下に書いたものは自動更新で消えない。
あなたの手書きメモはここに書く。

## 3. 導入

Obsidian を使っている**ローカルのマシン**で実行する（クラウドのリモートセッションからは Vault に触れない）。

```bash
git clone <このリポジトリ>
cd daihon-studio/tools/claude-obsidian

# 全プロジェクト共通で有効にする（推奨）
./install.sh

# パスを直接渡すことも、このリポジトリ限定にすることもできる
./install.sh "/Users/you/Documents/MyVault"
./install.sh "/Users/you/Documents/MyVault" --project
```

やること:
1. `~/.claude/obsidian-memory/` に本体と設定を置く
2. `~/.claude/settings.json` にフックを追記（既存設定は保持、`.bak` を作る）
3. `~/.claude/skills/obsidian-memory/` と `~/.claude/commands/{recall,remember}.md` を配置

インストール後、**Claude Code を起動し直す**と記録が始まる。

動作確認:

```bash
python3 ~/.claude/obsidian-memory/obsidian_memory.py doctor
```

## 4. 使い方

### 自動（何もしなくていい）
普通に Claude Code を使うだけ。セッションを開くと前回までの文脈が入り、
指示を出すと関連ノートが自動で参照される。

### 思い出させる

```
/recall 台本スタジオのPWAキャッシュ問題
```

または普通に「この前やった〜の続き」「あの案件どうなってたっけ」と言えば、
`obsidian-memory` スキルが働いて Vault を探しに行く。

### 覚えさせる

```
/remember Premiere 連携は MCP Bridge 経由で確定。ffmpeg 直叩きはしない。
```

プロジェクトノートの「このプロジェクトの前提・決定事項」に追記され、
以降そのフォルダで作業するたびに毎回読み込まれる。

## 5. 設定

`~/.claude/obsidian-memory/config.json`

| キー | 意味 |
|---|---|
| `vault` | Vault ルートの絶対パス（環境変数 `OBSIDIAN_VAULT` でも上書き可） |
| `root` / `sessions_dir` / `projects_dir` | 記録先フォルダ名 |
| `log.prompts` / `files` / `commands` / `summary` | 何を記録するか。不要なものは `false` |
| `daily_note.enabled` / `dir` / `format` / `heading` | 既存のデイリーノート運用に合わせる |
| `recall.session_start` | セッション開始時の自動読み込み |
| `recall.per_prompt` | 指示のたびの自動検索。うるさければ `false` |
| `recall.max_notes` / `min_score` | 自動読み込みの件数としきい値（増やすと文脈を食う） |
| `search_dirs` | 検索対象を特定フォルダに限定（空 = Vault 全体） |
| `exclude` | 検索・読み込みから外すフォルダ（`Private` など） |
| `redact` | APIキー等を伏字にする（既定 `true`） |

変更したら Claude Code を起動し直す。

## 6. プライバシーと注意

- 記録は**すべてローカルのファイル**。外部送信はしない。
- あなたの指示文と実行コマンドはそのまま Vault に残る。見られたくない内容を扱うなら
  `log.prompts` / `log.commands` を `false` にするか、`exclude` で切り分ける。
- APIキー・トークンらしき文字列は自動で伏字にするが、**完全ではない**。
  秘密情報を Vault に入れない運用のほうが安全。
- Vault を Git や共有ストレージに置いている場合、作業ログもそこへ同期される点に注意。

## 7. 困ったとき

| 症状 | 対処 |
|---|---|
| ノートができない | `python3 ~/.claude/obsidian-memory/obsidian_memory.py doctor` で Vault パスを確認 |
| 何も起きない | Claude Code を再起動したか / `claude --debug` でフックの実行ログを見る |
| 検索が古い | `python3 ~/.claude/obsidian-memory/obsidian_memory.py reindex` |
| 読み込みが多すぎる | `recall.max_notes` を減らす、`recall.per_prompt` を `false` に |
| エラーを調べたい | `~/.claude/obsidian-memory/obsidian-memory.log` |

フックは何が起きても必ず終了コード 0 を返す設計なので、
このブリッジが壊れても Claude Code の動作は止まらない。

## 8. 外す

```bash
./install.sh --uninstall        # フック設定だけ削除。ノートはそのまま残る
```
