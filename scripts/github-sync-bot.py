#!/usr/bin/env python3
# Sets up (or renews) the Forgejo bot account that brings GitHub pull requests in (scripts/github-pr-sync.mjs):
# a restricted user `github-sync` with READ access to marius/notepad (so its pull requests are untrusted: their CI
# needs approval and gets no secrets), its fork with Actions off, and a new token stored as the Actions secret
# SYNC_BOT_TOKEN (older tokens of the bot are deleted; the token is never printed). Needs an admin sign-in:
#
#   FJ_ADMIN=$(printf "protocol=https\nhost=git.1011.no\n\n" | git credential fill | sed -n "s/^password=//p") \
#     python3 -I scripts/github-sync-bot.py
import json, os, secrets, base64, urllib.request, urllib.error, time

F = "https://git.1011.no/api/v1"
ADMIN = os.environ["FJ_ADMIN"]
BOT = "github-sync"

def call(method, path, body=None, auth=None, ok=(200, 201, 204)):
    req = urllib.request.Request(F + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Authorization", auth or f"token {ADMIN}")
    if body is not None: req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read()
            return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode()[:300]
        if e.code in ok: return e.code, None
        return e.code, t

st, _ = call("GET", f"/users/{BOT}")
password = secrets.token_urlsafe(32)
if st == 404:
    st, r = call("POST", "/admin/users", {"username": BOT, "email": f"{BOT}@users.noreply.git.1011.no", "password": password,
        "must_change_password": False, "send_notify": False, "restricted": True, "visibility": "private",
        "full_name": "GitHub pull request sync"})
    print("create user:", st, r if st >= 300 else "ok")
else:
    # Existing bot: set a fresh password so a token can be made (the old one was never kept).
    st, r = call("PATCH", f"/admin/users/{BOT}", {"password": password, "must_change_password": False, "login_name": BOT, "source_id": 0})
    print("reset password:", st, r if st >= 300 else "ok")

st, r = call("PUT", f"/repos/marius/notepad/collaborators/{BOT}", {"permission": "read"})
print("read collaborator:", st, r if st >= 300 else "ok")

basic = "Basic " + base64.b64encode(f"{BOT}:{password}".encode()).decode()
name = "github-pr-sync-" + time.strftime("%Y%m%d%H%M%S")
st, tok = call("POST", f"/users/{BOT}/tokens", {"name": name, "scopes": ["write:repository", "write:issue"]}, auth=basic)
if st >= 300:
    print("token:", st, tok); raise SystemExit(1)
token = tok["sha1"]
# Remove older tokens of this bot (only the new one is used).
st, old = call("GET", f"/users/{BOT}/tokens", auth=basic)
for t in old or []:
    if t["name"] != name:
        print("delete old token", t["name"], call("DELETE", f"/users/{BOT}/tokens/{t['id']}", auth=basic)[0])
print("token created:", name, "scopes", tok.get("scopes"))
bot_auth = f"token {token}"

st, r = call("GET", f"/repos/{BOT}/notepad", auth=bot_auth)
if st == 404:
    st, r = call("POST", "/repos/marius/notepad/forks", {}, auth=bot_auth)
    print("fork:", st, r if st >= 300 else r["full_name"])
st, r = call("PATCH", f"/repos/{BOT}/notepad", {"has_actions": False, "has_issues": False, "has_wiki": False}, auth=bot_auth)
print("fork without actions:", st, r if st >= 300 else (r["has_actions"], r["private"]))

st, r = call("PUT", "/repos/marius/notepad/actions/secrets/SYNC_BOT_TOKEN", {"data": token})
print("secret SYNC_BOT_TOKEN:", st, r if st >= 300 else "set")
# The bot's password is discarded here; a new token can be made by running this again.
