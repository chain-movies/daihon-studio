#!/usr/bin/env python3
"""Google ドライブの共有リンク（ファイル or フォルダ）から素材をダウンロードする。

  pip install gdown
  python3 factory/chain-cut/fetch_drive.py "https://drive.google.com/drive/folders/xxxx" --out work/src

共有設定は「リンクを知っている全員（閲覧者）」にしておくこと。
大きな動画は MCP 経由では運べないので、ここで直接ダウンロードする。
"""
import argparse
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('url')
    ap.add_argument('--out', default='work/src')
    a = ap.parse_args()
    try:
        import gdown
    except ImportError:
        sys.exit('gdown がありません: pip install gdown')
    os.makedirs(a.out, exist_ok=True)
    if '/folders/' in a.url:
        files = gdown.download_folder(url=a.url, output=a.out, quiet=False, use_cookies=False, remaining_ok=True)
    else:
        f = gdown.download(url=a.url, output=a.out.rstrip('/') + '/', quiet=False, fuzzy=True, use_cookies=False)
        files = [f] if f else []
    files = [f for f in (files or []) if f]
    if not files:
        sys.exit('ダウンロードできませんでした。共有設定が「リンクを知っている全員」になっているか確認してください。')
    for f in files:
        print('✔', f, f'{os.path.getsize(f) / 1048576:.1f} MB')


if __name__ == '__main__':
    main()
