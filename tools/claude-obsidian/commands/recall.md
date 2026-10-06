---
description: Obsidian の過去ノートから、指定したテーマの記憶を検索して読み込む
argument-hint: [思い出したいこと]
allowed-tools: Bash(python3 *obsidian_memory.py*), Read, Glob, Grep
---

Obsidian Vault から「$ARGUMENTS」に関する記憶を検索し、いま取りかかる作業の前提として使ってください。

1. まず次を実行して候補を出す:

```
python3 ~/.claude/obsidian-memory/obsidian_memory.py recall "$ARGUMENTS"
```

2. 出てきたノートのうち関連の強いものは、`Read` で Vault 内の実ファイルを開いて中身を確認する（パスは検索結果の `パス:` 欄 + Vault ルート）。Vault ルートは次で確認できる:

```
python3 ~/.claude/obsidian-memory/obsidian_memory.py doctor
```

3. 分かったことを 5 行以内で要約して私に伝える。矛盾する記述が複数あるときは、更新日が新しい方を優先し、両方あることを明示する。

4. 検索で何も出てこなかった場合は、その旨をはっきり伝える（推測で埋めない）。
