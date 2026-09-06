#!/usr/bin/env bash
# Claude Code <-> Obsidian 記憶ブリッジ インストーラ
#
#   ./install.sh                       # 対話式（全プロジェクト共通 = ~/.claude に導入）
#   ./install.sh "/path/to/Vault"      # Vault パスを直接指定
#   ./install.sh "/path/to/Vault" --project   # このリポジトリだけに導入（.claude/）
#   ./install.sh --uninstall           # フック設定を削除
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOME_DIR="${HOME}"
MEM_HOME="${HOME_DIR}/.claude/obsidian-memory"

VAULT=""
SCOPE="user"
UNINSTALL=0
for arg in "$@"; do
  case "$arg" in
    --project) SCOPE="project" ;;
    --user) SCOPE="user" ;;
    --uninstall) UNINSTALL=1 ;;
    *) VAULT="$arg" ;;
  esac
done

if [ "$SCOPE" = "project" ]; then
  TARGET_DIR="$(pwd)/.claude"
else
  TARGET_DIR="${HOME_DIR}/.claude"
fi
SETTINGS="${TARGET_DIR}/settings.json"

PY="$(command -v python3 || true)"
if [ -z "$PY" ]; then
  echo "エラー: python3 が見つかりません。macOS なら 'xcode-select --install' で入ります。" >&2
  exit 1
fi

if [ "$UNINSTALL" = "1" ]; then
  "$PY" - "$SETTINGS" <<'PYEOF'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
if not p.exists():
    print("設定ファイルがありません:", p); raise SystemExit(0)
d = json.loads(p.read_text(encoding="utf-8"))
hooks = d.get("hooks", {})
for ev in list(hooks):
    kept = []
    for group in hooks[ev]:
        group["hooks"] = [h for h in group.get("hooks", [])
                          if "obsidian_memory.py" not in str(h.get("command", ""))]
        if group["hooks"]:
            kept.append(group)
    if kept:
        hooks[ev] = kept
    else:
        del hooks[ev]
if hooks:
    d["hooks"] = hooks
else:
    d.pop("hooks", None)
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("フック設定を削除しました:", p)
PYEOF
  echo "（記録済みのノートと ${MEM_HOME} は残しています。不要なら手動で削除してください）"
  exit 0
fi

# ---- Vault パスの決定 -----------------------------------------------------
if [ -z "$VAULT" ]; then
  echo "Obsidian Vault のフォルダパスを入力してください。"
  echo "  例: /Users/$(whoami)/Library/Mobile Documents/iCloud~md~obsidian/Documents/MyVault"
  printf "Vault パス: "
  read -r VAULT
fi
VAULT="${VAULT/#\~/$HOME_DIR}"
if [ ! -d "$VAULT" ]; then
  echo "エラー: そのフォルダが見つかりません: $VAULT" >&2
  exit 1
fi
if [ ! -d "$VAULT/.obsidian" ]; then
  echo "警告: $VAULT に .obsidian フォルダがありません。Vault のルートか確認してください。"
fi

# ---- 本体とスキル・コマンドを配置 -----------------------------------------
mkdir -p "$MEM_HOME/state" "$TARGET_DIR/skills" "$TARGET_DIR/commands"
cp "$SRC_DIR/obsidian_memory.py" "$MEM_HOME/obsidian_memory.py"
chmod +x "$MEM_HOME/obsidian_memory.py"
cp -R "$SRC_DIR/skills/obsidian-memory" "$TARGET_DIR/skills/"
cp "$SRC_DIR/commands/"*.md "$TARGET_DIR/commands/"

# ---- 設定ファイル ---------------------------------------------------------
if [ -f "$MEM_HOME/config.json" ]; then
  "$PY" - "$MEM_HOME/config.json" "$VAULT" <<'PYEOF'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1]); d = json.loads(p.read_text(encoding="utf-8"))
d["vault"] = sys.argv[2]
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("既存の設定を更新しました（vault のみ差し替え）:", p)
PYEOF
else
  "$PY" -c "
import json,sys,pathlib
src=pathlib.Path(sys.argv[1]); dst=pathlib.Path(sys.argv[2])
d=json.loads(src.read_text(encoding='utf-8')); d['vault']=sys.argv[3]
dst.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('設定を作成しました:',dst)
" "$SRC_DIR/config.example.json" "$MEM_HOME/config.json" "$VAULT"
fi

# ---- settings.json にフックを追記（既存設定は保持） ------------------------
"$PY" - "$SETTINGS" "$PY" "$MEM_HOME/obsidian_memory.py" <<'PYEOF'
import json, pathlib, sys, shutil

settings_path, python_bin, script = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
settings_path.parent.mkdir(parents=True, exist_ok=True)

data = {}
if settings_path.exists():
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8"))
    except Exception:
        print("既存の settings.json が壊れているため中断しました:", settings_path)
        raise SystemExit(1)
    shutil.copy2(settings_path, str(settings_path) + ".bak")

def cmd(event):
    return '"%s" "%s" hook %s' % (python_bin, script, event)

spec = [
    ("SessionStart",     None,                                        cmd("session-start"), False, 20),
    ("UserPromptSubmit", None,                                        cmd("prompt"),        False, 20),
    ("PostToolUse",      "Edit|Write|MultiEdit|NotebookEdit|Bash",     cmd("tool"),          True,  20),
    ("Stop",             None,                                        cmd("stop"),          True,  30),
    ("SessionEnd",       None,                                        cmd("session-end"),   False, 30),
]

hooks = data.get("hooks", {})
for event, matcher, command, is_async, timeout in spec:
    groups = hooks.get(event, [])
    # 既存の同ブリッジ設定は取り除いてから入れ直す（再実行しても重複しない）
    for g in groups:
        g["hooks"] = [h for h in g.get("hooks", []) if "obsidian_memory.py" not in str(h.get("command", ""))]
    groups = [g for g in groups if g.get("hooks")]
    entry = {"type": "command", "command": command, "timeout": timeout}
    if is_async:
        entry["async"] = True
    group = {"hooks": [entry]}
    if matcher:
        group["matcher"] = matcher
    groups.append(group)
    hooks[event] = groups
data["hooks"] = hooks

settings_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("フックを設定しました:", settings_path)
PYEOF

echo
echo "セットアップ完了。動作確認:"
echo "  \"$PY\" \"$MEM_HOME/obsidian_memory.py\" doctor"
"$PY" "$MEM_HOME/obsidian_memory.py" doctor || true
echo
echo "次に Claude Code を新しく起動すると、記録が始まります。"
