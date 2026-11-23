#!/usr/bin/env bash
# Prints a GitHub installation access token (valid for 1 hour) for the GitHub App that publishes Notepad on
# github.com/MariusEng/notepad: a JWT signed with the app's private key → the app's installation on that repository
# → a token limited to that repository. Nothing is printed except the token.
#
# `github-token.sh --permissions` prints what the token may do instead (e.g. contents=write workflows=write).
# Env: GH_APP_ID, GH_APP_PRIVATE_KEY (the PEM text), GITHUB_REPO (default MariusEng/notepad).
set -euo pipefail

: "${GH_APP_ID:?set GH_APP_ID}"
: "${GH_APP_PRIVATE_KEY:?set GH_APP_PRIVATE_KEY}"
repo="${GITHUB_REPO:-MariusEng/notepad}"
command -v openssl >/dev/null || { echo "openssl is needed" >&2; exit 1; }

key=$(mktemp)
trap 'rm -f "$key"' EXIT
chmod 600 "$key"
printf '%s\n' "$GH_APP_PRIVATE_KEY" >"$key"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
header=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
# Issued a minute ago (clock drift), valid for 9 minutes (GitHub allows 10).
payload=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' $((now - 60)) $((now + 540)) "$GH_APP_ID" | b64url)
sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -sign "$key" -binary | b64url)
jwt="$header.$payload.$sig"

h=(-H "Authorization: Bearer $jwt" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
inst=$(curl -fsS "${h[@]}" "https://api.github.com/repos/$repo/installation" |
  python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null) ||
  { echo "The GitHub App isn't installed on $repo (or GH_APP_ID / the key is wrong)." >&2; exit 1; }
curl -fsS -X POST "${h[@]}" -d "{\"repositories\":[\"${repo#*/}\"]}" \
  "https://api.github.com/app/installations/$inst/access_tokens" |
  python3 -c "
import json,sys
r=json.load(sys.stdin)
if sys.argv[1:] == ['--permissions']: print(' '.join(f'{k}={v}' for k, v in sorted(r.get('permissions', {}).items())))
else: print(r['token'])" "$@"
