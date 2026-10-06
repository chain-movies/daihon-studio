---
description: いまの決定事項・前提を Obsidian のプロジェクトノートに永続化する
argument-hint: [覚えておくこと]
allowed-tools: Bash(python3 *obsidian_memory.py*)
---

次の内容を Obsidian のプロジェクトノートに追記して、今後のセッションでも思い出せるようにしてください。

内容: $ARGUMENTS

引数が空のときは、直前までのやりとりから「今後も引き継ぐべき決定・前提」を 1〜3 行にまとめ、それを内容として使う。

実行するコマンド:

```
python3 ~/.claude/obsidian-memory/obsidian_memory.py remember "（ここに内容）"
```

実行後、どのノートのどこに書いたかを一行で報告する。
