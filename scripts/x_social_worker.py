#!/usr/bin/env python3
"""One-shot, low-volume X search bridge for MEME RADAR. Cookies arrive only on stdin."""
import asyncio
import json
import os
import sys
import tempfile
from datetime import timezone


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()


async def collect(payload):
    from twscrape import API, AccountsPool

    cookies = str(payload.get("cookies") or "")
    queries = [str(x).strip()[:160] for x in payload.get("queries", []) if str(x).strip()][:3]
    limit = max(1, min(15, int(payload.get("limitPerQuery") or 15)))
    if not cookies or not queries:
        raise ValueError("Configuration X absente")

    with tempfile.TemporaryDirectory(prefix="meme-radar-x-") as temp_dir:
        try:
            os.chmod(temp_dir, 0o700)
        except OSError:
            pass
        db_path = os.path.join(temp_dir, "session.sqlite")
        pool = AccountsPool(db_file=db_path, raise_when_no_account=True, wait_timeout=2)
        await pool.add_account_cookies("meme-radar-session", cookies)
        api = API(pool=pool, raise_when_no_account=True, wait_timeout=2)

        posts = {}
        queries_run = 0
        for query in queries:
            queries_run += 1
            async for tweet in api.search(query, limit=limit):
                tweet_id = str(getattr(tweet, "id_str", "") or getattr(tweet, "id", ""))
                if not tweet_id or tweet_id in posts:
                    continue
                user = getattr(tweet, "user", None)
                date = getattr(tweet, "date", None)
                if date is None:
                    continue
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
                posts[tweet_id] = {
                    "id": tweet_id,
                    "text": str(getattr(tweet, "rawContent", "") or "")[:3000],
                    "url": str(getattr(tweet, "url", "") or "")[:500],
                    "publishedAt": date.isoformat(),
                    "author": str(getattr(user, "username", "") or "")[:64],
                    "followers": int(getattr(user, "followersCount", 0) or 0),
                    "likes": int(getattr(tweet, "likeCount", 0) or 0),
                    "reposts": int(getattr(tweet, "retweetCount", 0) or 0),
                    "replies": int(getattr(tweet, "replyCount", 0) or 0),
                    "views": int(getattr(tweet, "viewCount", 0) or 0),
                }
        return {"ok": True, "queriesRun": queries_run, "posts": list(posts.values())[:45]}


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = asyncio.run(collect(payload))
        emit(result)
    except Exception as exc:
        # Never print exception text: HTTP errors and library internals can contain sensitive data.
        emit({"ok": False, "error": "Collecteur X indisponible (" + type(exc).__name__ + ")."})
        raise SystemExit(1)


if __name__ == "__main__":
    main()
