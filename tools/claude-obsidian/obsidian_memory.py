#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
obsidian_memory.py — Claude Code の作業内容を Obsidian に自動で記録し、
次回以降の指示のときに Obsidian から記憶をたどるためのブリッジ。

依存なし（Python 3.8+ 標準ライブラリのみ）。

使い方（詳細は README.md）:
    obsidian_memory.py hook session-start   < hook_input.json
    obsidian_memory.py hook prompt          < hook_input.json
    obsidian_memory.py hook tool            < hook_input.json
    obsidian_memory.py hook stop            < hook_input.json
    obsidian_memory.py hook session-end     < hook_input.json
    obsidian_memory.py recall "クエリ"      # 記憶を検索して Markdown で出力
    obsidian_memory.py remember "本文"      # 決定事項・学びを蓄積
    obsidian_memory.py reindex
    obsidian_memory.py doctor

設計上の約束:
  - フックは絶対に Claude Code を止めない。何が起きても exit 0。
  - 生成部分と手書き部分をマーカーで分離し、人間が書いた内容は壊さない。
"""

import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
BASE = Path(os.environ.get("OBSIDIAN_MEMORY_HOME", HOME / ".claude" / "obsidian-memory"))
CONFIG_PATH = BASE / "config.json"
STATE_DIR = BASE / "state"
INDEX_PATH = BASE / "index.json"
LOG_PATH = BASE / "obsidian-memory.log"

AUTO_END = "<!-- claude-memory:auto-end / この行より下は自由に編集して構いません -->"

DEFAULTS = {
    "vault": "",
    "root": "ClaudeCode",
    "sessions_dir": "Sessions",
    "projects_dir": "Projects",
    "log": {"prompts": True, "files": True, "commands": True, "summary": True,
            "max_prompt_chars": 1200, "max_command_chars": 300},
    "daily_note": {"enabled": True, "dir": "Daily", "format": "%Y-%m-%d",
                   "heading": "## Claude Code"},
    "recall": {"session_start": True, "per_prompt": True, "max_notes": 3,
               "max_chars": 700, "min_score": 1.5},
    "search_dirs": [],
    "exclude": [".obsidian", ".trash", "Templates"],
    "redact": True,
    "locale": "ja",
}

# --------------------------------------------------------------------------
# 基本ユーティリティ
# --------------------------------------------------------------------------


def log(msg):
    try:
        BASE.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as f:
            f.write("%s %s\n" % (datetime.now().isoformat(timespec="seconds"), msg))
    except Exception:
        pass


def deep_merge(base, override):
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config():
    cfg = dict(DEFAULTS)
    try:
        if CONFIG_PATH.exists():
            cfg = deep_merge(cfg, json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except Exception as e:
        log("config load failed: %r" % e)
    env_vault = os.environ.get("OBSIDIAN_VAULT")
    if env_vault:
        cfg["vault"] = env_vault
    cfg["vault"] = os.path.expanduser(cfg.get("vault") or "")
    return cfg


def vault_root(cfg):
    v = cfg.get("vault")
    if not v:
        return None
    p = Path(v)
    return p if p.is_dir() else None


def now_local():
    return datetime.now()


def iso_min(dt=None):
    return (dt or now_local()).strftime("%Y-%m-%dT%H:%M")


def safe_slug(text, maxlen=48):
    text = unicodedata.normalize("NFKC", str(text or "")).strip()
    text = re.sub(r"[\\/:*?\"<>|#^\[\]\n\r\t]+", "-", text)
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-. ")
    return (text[:maxlen] or "untitled")


REDACTIONS = [
    (re.compile(r"\b(sk-[A-Za-z0-9_\-]{16,})"), "sk-***"),
    (re.compile(r"\b(ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"), "gh-***"),
    (re.compile(r"\b(AKIA[0-9A-Z]{12,})"), "AKIA***"),
    (re.compile(r"\b(AIza[0-9A-Za-z_\-]{20,})"), "AIza***"),
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._\-]{16,}"), r"\1 ***"),
    (re.compile(r"(?i)\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|APIKEY|API_KEY)[A-Z0-9_]*)\s*=\s*\S+"), r"\1=***"),
]


def redact(text, enabled=True):
    if not text:
        return ""
    if not enabled:
        return text
    out = text
    for pat, rep in REDACTIONS:
        out = pat.sub(rep, out)
    return out


def clip(text, limit):
    text = (text or "").strip()
    if limit and len(text) > limit:
        return text[:limit].rstrip() + " …(略)"
    return text


def read_hook_input():
    try:
        raw = sys.stdin.read()
    except Exception:
        raw = ""
    if not raw.strip():
        return {}
    try:
        return json.loads(raw)
    except Exception:
        log("hook stdin was not JSON (%d bytes)" % len(raw))
        return {}


def project_name(cwd):
    try:
        return Path(cwd).name or "unknown"
    except Exception:
        return "unknown"


def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp%d" % os.getpid())
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


# --------------------------------------------------------------------------
# 検索（日本語対応の簡易インデックス）
# --------------------------------------------------------------------------

CJK = re.compile(r"[぀-ヿ㐀-䶿一-鿿ｦ-ﾟ]")
STOP = {"the", "and", "for", "with", "this", "that", "から", "して", "する", "した",
        "ください", "です", "ます", "こと", "ため", "よう", "いる", "ある", "れる"}


def tokenize(text):
    """英数字は単語単位、日本語は 2-gram に分解して集合を返す。"""
    text = unicodedata.normalize("NFKC", (text or "")).lower()
    tokens = set()
    for w in re.findall(r"[a-z0-9_][a-z0-9_.\-]{1,}", text):
        if w not in STOP and len(w) >= 2:
            tokens.add(w)
    cjk_runs = re.findall(r"[぀-ヿ㐀-䶿一-鿿]{2,}", text)
    for run in cjk_runs:
        for i in range(len(run) - 1):
            bg = run[i:i + 2]
            if bg not in STOP:
                tokens.add(bg)
    return tokens


def is_excluded(rel, cfg):
    rel_s = str(rel).replace(os.sep, "/")
    for ex in cfg.get("exclude", []):
        if not ex:
            continue
        if rel_s == ex or rel_s.startswith(ex.rstrip("/") + "/") or ("/%s/" % ex.strip("/")) in ("/" + rel_s):
            return True
    return False


def iter_notes(cfg):
    root = vault_root(cfg)
    if not root:
        return
    search_dirs = cfg.get("search_dirs") or [""]
    seen = set()
    for sd in search_dirs:
        base = root / sd if sd else root
        if not base.is_dir():
            continue
        for p in base.rglob("*.md"):
            try:
                rel = p.relative_to(root)
            except Exception:
                continue
            if rel in seen or is_excluded(rel, cfg):
                continue
            seen.add(rel)
            yield p, rel


def build_index(cfg, force=False):
    root = vault_root(cfg)
    if not root:
        return {"vault": "", "notes": {}}
    old = {}
    if INDEX_PATH.exists() and not force:
        try:
            data = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
            if data.get("vault") == str(root):
                old = data.get("notes", {})
        except Exception:
            old = {}
    notes = {}
    for p, rel in iter_notes(cfg):
        key = str(rel).replace(os.sep, "/")
        try:
            st = p.stat()
        except Exception:
            continue
        prev = old.get(key)
        if prev and abs(prev.get("mtime", 0) - st.st_mtime) < 0.001 and prev.get("size") == st.st_size:
            notes[key] = prev
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        notes[key] = {
            "mtime": st.st_mtime,
            "size": st.st_size,
            "title": p.stem,
            "excerpt": summarize_note(text),
            "tokens": sorted(tokenize(p.stem + "\n" + text[:20000])),
        }
    data = {"vault": str(root), "built": time.time(), "notes": notes}
    try:
        BASE.mkdir(parents=True, exist_ok=True)
        atomic_write(INDEX_PATH, json.dumps(data, ensure_ascii=False))
    except Exception as e:
        log("index write failed: %r" % e)
    return data


def summarize_note(text, limit=600):
    body = text
    if body.startswith("---"):
        end = body.find("\n---", 3)
        if end != -1:
            body = body[end + 4:]
    lines = []
    for line in body.splitlines():
        s = line.strip()
        if not s or s.startswith("<!--") or s.startswith("![") or s == AUTO_END:
            continue
        lines.append(s)
        if sum(len(x) for x in lines) > limit:
            break
    return clip(" / ".join(lines), limit)


def search(cfg, query, limit=5, min_score=0.0, exclude_paths=()):
    data = build_index(cfg)
    q = tokenize(query)
    if not q:
        return []
    results = []
    for key, note in data.get("notes", {}).items():
        if key in exclude_paths:
            continue
        toks = set(note.get("tokens", []))
        if not toks:
            continue
        hits = q & toks
        if not hits:
            continue
        score = len(hits) / (len(q) ** 0.5)
        title_hits = q & tokenize(note.get("title", ""))
        score += 1.5 * len(title_hits)
        age_days = max(0.0, (time.time() - note.get("mtime", 0)) / 86400.0)
        score += 0.8 if age_days < 30 else (0.4 if age_days < 120 else 0.0)
        results.append((score, key, note))
    results.sort(key=lambda r: (-r[0], r[1]))
    return [r for r in results[:limit] if r[0] >= min_score]


def render_recall(cfg, results, header="関連する過去の記憶（Obsidian）"):
    if not results:
        return ""
    maxc = int(cfg.get("recall", {}).get("max_chars", 700))
    out = ["## %s" % header, ""]
    for score, key, note in results:
        out.append("### [[%s]]" % note.get("title") or key)
        out.append("- パス: `%s`  / 更新: %s" % (
            key, datetime.fromtimestamp(note.get("mtime", 0)).strftime("%Y-%m-%d")))
        out.append("- 要約: %s" % clip(note.get("excerpt", ""), maxc))
        out.append("")
    out.append("_これは Obsidian Vault から自動で拾ってきた過去の記録です。今回の指示と矛盾する場合は今回の指示を優先してください。_")
    return "\n".join(out)


# --------------------------------------------------------------------------
# セッション状態（フック呼び出しをまたいで蓄積する）
# --------------------------------------------------------------------------


def state_path(session_id):
    return STATE_DIR / ("%s.json" % safe_slug(session_id or "nosession", 64))


def load_state(session_id):
    p = state_path(session_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def save_state(session_id, state):
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        atomic_write(state_path(session_id), json.dumps(state, ensure_ascii=False))
    except Exception as e:
        log("state write failed: %r" % e)


def new_state(payload, cfg):
    cwd = payload.get("cwd") or os.getcwd()
    proj = project_name(cwd)
    started = now_local()
    sid = payload.get("session_id") or "nosession"
    rel = "%s/%s/%s/%s.md" % (
        cfg.get("root", "ClaudeCode"),
        cfg.get("sessions_dir", "Sessions"),
        started.strftime("%Y-%m"),
        "%s %s %s" % (started.strftime("%Y-%m-%d %H%M"), safe_slug(proj, 32), sid[:6]),
    )
    return {
        "session_id": sid,
        "project": proj,
        "cwd": cwd,
        "started": iso_min(started),
        "started_ts": time.time(),
        "note": rel,
        "title": "%s %s" % (started.strftime("%Y-%m-%d %H%M"), proj),
        "prompts": [],
        "files": {},
        "commands": [],
        "notes": [],
        "summary": "",
        "ended": "",
        "recalled": [],
    }


def ensure_state(payload, cfg):
    sid = payload.get("session_id") or "nosession"
    st = load_state(sid)
    if not st or not st.get("note"):
        st = new_state(payload, cfg)
    return st


# --------------------------------------------------------------------------
# ノート生成
# --------------------------------------------------------------------------


def yaml_list(items):
    return "[%s]" % ", ".join(json.dumps(i, ensure_ascii=False) for i in items)


def render_session_note(st, cfg):
    tags = ["claude-code", "claude-code/%s" % safe_slug(st.get("project", ""), 32)]
    fm = [
        "---",
        "type: claude-session",
        "project: %s" % json.dumps(st.get("project", ""), ensure_ascii=False),
        "session_id: %s" % st.get("session_id", ""),
        "cwd: %s" % json.dumps(st.get("cwd", ""), ensure_ascii=False),
        "date: %s" % (st.get("started", "")[:10]),
        "started: %s" % st.get("started", ""),
        "ended: %s" % (st.get("ended") or ""),
        "tags: %s" % yaml_list(tags),
        "---",
        "",
    ]
    body = ["# %s" % st.get("title", "Claude Code セッション"), ""]
    body.append("プロジェクト: [[%s/%s/%s|%s]]" % (
        cfg.get("root", "ClaudeCode"), cfg.get("projects_dir", "Projects"),
        safe_slug(st.get("project", ""), 48), st.get("project", "")))
    body.append("")

    if st.get("summary"):
        body += ["## まとめ", "", st["summary"], ""]

    if st.get("prompts"):
        body += ["## 指示（あなたが言ったこと）", ""]
        for p in st["prompts"]:
            body.append("- **%s** %s" % (p.get("at", ""), p.get("text", "").replace("\n", "  \n  ")))
        body.append("")

    if st.get("files"):
        body += ["## 変更したファイル", ""]
        for path in sorted(st["files"].keys()):
            info = st["files"][path]
            body.append("- `%s` — %s（%d回）" % (path, info.get("kind", "編集"), info.get("count", 1)))
        body.append("")

    if st.get("commands"):
        body += ["## 実行したコマンド", "", "```sh"]
        for c in st["commands"]:
            body.append(c)
        body += ["```", ""]

    if st.get("notes"):
        body += ["## 決定・学び", ""]
        for n in st["notes"]:
            body.append("- **%s** %s" % (n.get("at", ""), n.get("text", "")))
        body.append("")

    if st.get("recalled"):
        body += ["## 参照した過去の記憶", ""]
        for r in st["recalled"]:
            body.append("- [[%s]]" % r)
        body.append("")

    body.append(AUTO_END)
    body.append("")
    return "\n".join(fm + body)


def write_with_marker(path, generated):
    """AUTO_END マーカーより下（人間が書いた部分）は必ず温存する。"""
    tail = ""
    if path.exists():
        try:
            old = path.read_text(encoding="utf-8")
            idx = old.find(AUTO_END)
            if idx != -1:
                tail = old[idx + len(AUTO_END):]
        except Exception as e:
            log("read before write failed: %r" % e)
    atomic_write(path, generated + tail.lstrip("\n"))


def flush_session_note(st, cfg):
    root = vault_root(cfg)
    if not root:
        return None
    path = root / st["note"]
    write_with_marker(path, render_session_note(st, cfg))
    return path


def append_once(path, heading, line):
    """指定の見出し節の末尾に一行追記。同じ行が既にあれば何もしない。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    text = path.read_text(encoding="utf-8") if path.exists() else ""
    if line.strip() and line.strip() in text:
        return
    lines = text.splitlines()
    level = len(heading) - len(heading.lstrip("#")) if heading else 0
    start = None
    if heading:
        for i, l in enumerate(lines):
            if l.strip() == heading.strip():
                start = i
                break
    if start is None:
        out = list(lines)
        while out and not out[-1].strip():
            out.pop()
        if out:
            out.append("")
        if heading:
            out += [heading, ""]
        out.append(line)
        atomic_write(path, "\n".join(out) + "\n")
        return
    end = len(lines)
    for j in range(start + 1, len(lines)):
        stripped = lines[j].lstrip()
        if stripped.startswith("#"):
            hl = len(stripped) - len(stripped.lstrip("#"))
            if 0 < hl <= level:
                end = j
                break
        if lines[j].strip() == AUTO_END:
            end = j
            break
    body = lines[start + 1:end]
    while body and not body[-1].strip():
        body.pop()
    body.append(line)
    atomic_write(path, "\n".join(lines[:start + 1] + body + [""] + lines[end:]).rstrip("\n") + "\n")


def update_daily_note(st, cfg):
    dn = cfg.get("daily_note", {})
    root = vault_root(cfg)
    if not root or not dn.get("enabled", True):
        return
    try:
        fname = now_local().strftime(dn.get("format", "%Y-%m-%d")) + ".md"
        path = root / dn.get("dir", "Daily") / fname
        title = Path(st["note"]).stem
        first = st["prompts"][0]["text"] if st.get("prompts") else st.get("summary", "")
        line = "- [[%s]] — %s / %s" % (title, st.get("project", ""), clip(first.replace("\n", " "), 80))
        append_once(path, dn.get("heading", "## Claude Code"), line)
    except Exception as e:
        log("daily note failed: %r" % e)


def update_project_note(st, cfg):
    root = vault_root(cfg)
    if not root:
        return
    try:
        path = root / cfg.get("root", "ClaudeCode") / cfg.get("projects_dir", "Projects") / (
            safe_slug(st.get("project", ""), 48) + ".md")
        title = Path(st["note"]).stem
        summary = clip((st.get("summary") or (st["prompts"][0]["text"] if st.get("prompts") else "")).replace("\n", " "), 120)
        if not path.exists():
            head = "\n".join([
                "---",
                "type: claude-project",
                "project: %s" % json.dumps(st.get("project", ""), ensure_ascii=False),
                "cwd: %s" % json.dumps(st.get("cwd", ""), ensure_ascii=False),
                "tags: %s" % yaml_list(["claude-code", "claude-code/%s" % safe_slug(st.get("project", ""), 32)]),
                "---",
                "",
                "# %s" % st.get("project", ""),
                "",
                "作業ディレクトリ: `%s`" % st.get("cwd", ""),
                "",
                "## このプロジェクトの前提・決定事項",
                "",
                "<!-- ここは人間が書くエリア。Claude はここを読んでから作業します。 -->",
                "",
                "## セッション履歴",
                "",
            ])
            atomic_write(path, head)
        append_once(path, "## セッション履歴", "- %s [[%s]] — %s" % (st.get("started", "")[:10], title, summary))
    except Exception as e:
        log("project note failed: %r" % e)


# --------------------------------------------------------------------------
# フック本体
# --------------------------------------------------------------------------


def emit(event_name, additional_context="", system_message=""):
    out = {"hookSpecificOutput": {"hookEventName": event_name}}
    if additional_context:
        out["hookSpecificOutput"]["additionalContext"] = additional_context
    if system_message:
        out["hookSpecificOutput"]["systemMessage"] = system_message
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    sys.stdout.flush()


def last_assistant_text(transcript_path, limit=1500):
    """トランスクリプト(JSONL)から直近のアシスタント発話を取り出してまとめに使う。"""
    if not transcript_path:
        return ""
    p = Path(os.path.expanduser(transcript_path))
    if not p.exists():
        return ""
    texts = []
    try:
        with p.open("r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()[-400:]
    except Exception:
        return ""
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        if rec.get("type") != "assistant":
            continue
        msg = rec.get("message") or {}
        content = msg.get("content")
        chunk = []
        if isinstance(content, str):
            chunk.append(content)
        elif isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and c.get("type") == "text" and c.get("text"):
                    chunk.append(c["text"])
        if chunk:
            texts = chunk
            break
    return clip("\n".join(texts).strip(), limit)


def recent_sessions(cfg, cwd, limit=3, exclude_note=None):
    """同じ作業ディレクトリの直近セッションノートを新しい順に返す。"""
    root = vault_root(cfg)
    if not root:
        return []
    sess_dir = root / cfg.get("root", "ClaudeCode") / cfg.get("sessions_dir", "Sessions")
    if not sess_dir.is_dir():
        return []
    cands = []
    for p in sess_dir.rglob("*.md"):
        try:
            rel = str(p.relative_to(root)).replace(os.sep, "/")
            if exclude_note and rel == exclude_note:
                continue
            head = p.read_text(encoding="utf-8", errors="replace")[:1200]
            m = re.search(r'^cwd:\s*"?(.*?)"?\s*$', head, re.M)
            if m and cwd and os.path.normpath(m.group(1)) != os.path.normpath(cwd):
                continue
            cands.append((p.stat().st_mtime, p, rel))
        except Exception:
            continue
    cands.sort(key=lambda c: -c[0])
    return cands[:limit]


def hook_session_start(payload, cfg):
    st = ensure_state(payload, cfg)
    if payload.get("cwd"):
        st["cwd"] = payload["cwd"]
        st["project"] = project_name(payload["cwd"])
    save_state(st["session_id"], st)

    if not cfg.get("recall", {}).get("session_start", True) or not vault_root(cfg):
        emit("SessionStart")
        return

    parts = []
    root = vault_root(cfg)
    proj_note = root / cfg.get("root", "ClaudeCode") / cfg.get("projects_dir", "Projects") / (
        safe_slug(st["project"], 48) + ".md")
    if proj_note.exists():
        try:
            parts.append("### プロジェクトノート（Obsidian: `%s`）\n\n%s" % (
                proj_note.name, clip(proj_note.read_text(encoding="utf-8", errors="replace"), 2500)))
        except Exception:
            pass
    recents = recent_sessions(cfg, st["cwd"], limit=3, exclude_note=st.get("note"))
    if recents:
        lines = ["### 直近のこのプロジェクトでの作業（Obsidian）", ""]
        for _mt, p, rel in recents:
            try:
                lines.append("- **%s**: %s" % (p.stem, clip(summarize_note(p.read_text(encoding="utf-8", errors="replace")), 400)))
            except Exception:
                continue
        parts.append("\n".join(lines))
    if not parts:
        emit("SessionStart")
        return
    ctx = ("## Obsidian に保存されている、この作業ディレクトリの記憶\n\n"
           + "\n\n".join(parts)
           + "\n\n_出典は Obsidian Vault の過去ノートです。現在のコードや今回の指示と食い違う場合は、"
             "そちらを優先してください。_")
    emit("SessionStart", additional_context=ctx)


def hook_prompt(payload, cfg):
    st = ensure_state(payload, cfg)
    text = payload.get("prompt") or payload.get("user_prompt") or ""
    logcfg = cfg.get("log", {})
    if text and logcfg.get("prompts", True):
        st["prompts"].append({
            "at": iso_min(),
            "text": clip(redact(text, cfg.get("redact", True)), int(logcfg.get("max_prompt_chars", 1200))),
        })
        save_state(st["session_id"], st)
        try:
            flush_session_note(st, cfg)
        except Exception as e:
            log("flush on prompt failed: %r" % e)

    rc = cfg.get("recall", {})
    if not text or not rc.get("per_prompt", True) or not vault_root(cfg):
        emit("UserPromptSubmit")
        return
    results = search(cfg, text,
                     limit=int(rc.get("max_notes", 3)),
                     min_score=float(rc.get("min_score", 1.5)),
                     exclude_paths=(st.get("note"),))
    if not results:
        emit("UserPromptSubmit")
        return
    for _s, key, note in results:
        title = note.get("title") or key
        if title not in st["recalled"]:
            st["recalled"].append(title)
    save_state(st["session_id"], st)
    emit("UserPromptSubmit", additional_context=render_recall(cfg, results))


EDIT_TOOLS = {"Edit", "Write", "NotebookEdit", "MultiEdit"}


def hook_tool(payload, cfg):
    st = ensure_state(payload, cfg)
    tool = payload.get("tool_name") or ""
    ti = payload.get("tool_input") or {}
    logcfg = cfg.get("log", {})
    changed = False

    if tool in EDIT_TOOLS and logcfg.get("files", True):
        fp = ti.get("file_path") or ti.get("notebook_path") or ""
        if fp:
            try:
                rel = os.path.relpath(fp, st.get("cwd") or os.getcwd())
            except Exception:
                rel = fp
            kind = "新規作成" if tool == "Write" else "編集"
            ent = st["files"].get(rel) or {"kind": kind, "count": 0}
            ent["count"] += 1
            if tool == "Write" and ent["kind"] != "新規作成":
                ent["kind"] = "編集・上書き"
            st["files"][rel] = ent
            changed = True

    if tool == "Bash" and logcfg.get("commands", True):
        cmd = clip(redact(ti.get("command") or "", cfg.get("redact", True)),
                   int(logcfg.get("max_command_chars", 300))).replace("\n", " ")
        if cmd and cmd not in st["commands"]:
            st["commands"].append(cmd)
            changed = True

    if changed:
        save_state(st["session_id"], st)
        try:
            flush_session_note(st, cfg)
        except Exception as e:
            log("flush on tool failed: %r" % e)
    emit("PostToolUse")


def finalize(payload, cfg, ended=False):
    st = ensure_state(payload, cfg)
    if cfg.get("log", {}).get("summary", True):
        summary = last_assistant_text(payload.get("transcript_path"))
        if summary:
            st["summary"] = summary
    if ended:
        st["ended"] = iso_min()
    save_state(st["session_id"], st)
    if not vault_root(cfg):
        return st
    if st.get("prompts") or st.get("files") or st.get("commands") or st.get("summary"):
        flush_session_note(st, cfg)
        update_project_note(st, cfg)
        update_daily_note(st, cfg)
    return st


def hook_stop(payload, cfg):
    finalize(payload, cfg, ended=False)
    emit("Stop")


def hook_session_end(payload, cfg):
    finalize(payload, cfg, ended=True)
    prune_state(days=45)
    emit("SessionEnd")


def prune_state(days=45):
    """古いセッション状態だけ掃除する。直近の状態は再開・追記のために残す。"""
    try:
        cutoff = time.time() - days * 86400
        for p in STATE_DIR.glob("*.json"):
            if p.stat().st_mtime < cutoff:
                p.unlink()
    except Exception:
        pass


HOOKS = {
    "session-start": hook_session_start,
    "prompt": hook_prompt,
    "tool": hook_tool,
    "stop": hook_stop,
    "session-end": hook_session_end,
}


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def cmd_hook(argv):
    event = argv[0] if argv else ""
    payload = read_hook_input()
    cfg = load_config()
    fn = HOOKS.get(event)
    if not fn:
        log("unknown hook event: %r" % event)
        return
    fn(payload, cfg)


def cmd_recall(argv):
    cfg = load_config()
    if not vault_root(cfg):
        print("Obsidian Vault が設定されていません。`obsidian_memory.py doctor` を実行してください。")
        return
    query = " ".join(argv).strip()
    if not query:
        print("使い方: obsidian_memory.py recall \"検索したいこと\"")
        return
    results = search(cfg, query, limit=8, min_score=0.0)
    if not results:
        print("Obsidian に「%s」に関する記録は見つかりませんでした。" % query)
        return
    print(render_recall(cfg, results, header="「%s」に関する記憶" % query))


def cmd_remember(argv):
    cfg = load_config()
    text = " ".join(argv).strip()
    if not text:
        print("使い方: obsidian_memory.py remember \"覚えておくこと\"")
        return
    if not vault_root(cfg):
        print("Obsidian Vault が設定されていません。")
        return
    cwd = os.getcwd()
    proj = project_name(cwd)
    root = vault_root(cfg)
    path = root / cfg.get("root", "ClaudeCode") / cfg.get("projects_dir", "Projects") / (safe_slug(proj, 48) + ".md")
    if not path.exists():
        update_project_note({"project": proj, "cwd": cwd, "started": iso_min(),
                             "note": "%s/%s/_.md" % (cfg.get("root", "ClaudeCode"), cfg.get("sessions_dir", "Sessions")),
                             "prompts": [], "summary": ""}, cfg)
    append_once(path, "## このプロジェクトの前提・決定事項",
                "- %s %s" % (now_local().strftime("%Y-%m-%d"), redact(text, cfg.get("redact", True))))
    print("Obsidian に記録しました: %s" % path)


def cmd_reindex(_argv):
    cfg = load_config()
    if not vault_root(cfg):
        print("Obsidian Vault が設定されていません。")
        return
    data = build_index(cfg, force=True)
    print("インデックスを作り直しました: %d ノート -> %s" % (len(data.get("notes", {})), INDEX_PATH))


def cmd_doctor(_argv):
    cfg = load_config()
    print("設定ファイル : %s (%s)" % (CONFIG_PATH, "あり" if CONFIG_PATH.exists() else "なし"))
    print("Vault        : %s" % (cfg.get("vault") or "(未設定)"))
    root = vault_root(cfg)
    print("Vault 存在   : %s" % ("OK" if root else "NG（パスが見つかりません）"))
    if root:
        n = sum(1 for _ in iter_notes(cfg))
        print("対象ノート数 : %d" % n)
        print("記録先       : %s" % (root / cfg.get("root", "ClaudeCode")))
    print("状態ファイル : %s" % STATE_DIR)
    print("ログ         : %s" % LOG_PATH)
    print("Python       : %s" % sys.version.split()[0])


COMMANDS = {"hook": cmd_hook, "recall": cmd_recall, "remember": cmd_remember,
            "reindex": cmd_reindex, "doctor": cmd_doctor}


def main():
    argv = sys.argv[1:]
    cmd = argv[0] if argv else "doctor"
    fn = COMMANDS.get(cmd)
    if not fn:
        print(__doc__)
        return
    fn(argv[1:])


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # フックは絶対に Claude Code を止めない
        log("fatal: %r" % e)
    sys.exit(0)
