Threads の長期アクセストークンは約60日で失効します。失効すると X への投稿は続きますが、Threads への投稿だけが止まります。

**更新手順（いまのトークンがまだ有効なうちに実行）**

```
curl -s "https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=<現在のトークン>"
```

返ってきた `access_token` を、リポジトリの
Settings → Secrets and variables → Actions → `THREADS_ACCESS_TOKEN` に上書き保存してください。

詳細は `docs/SOCIAL_AUTO_POST.md` の「トークンの更新」を参照。
