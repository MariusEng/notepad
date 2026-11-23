#!/usr/bin/env bash
# One-time setup of the GitHub copy (https://github.com/MariusEng/notepad) with a GitHub App. Run it in your own
# terminal after creating and installing the app (see README → GitHub):
#
#   scripts/github-setup.sh <app id> <private key .pem file>
#
# It checks that the app can push to the repository, then stores the app id and the key as the Forgejo Actions
# secrets GH_APP_ID and GH_APP_PRIVATE_KEY, which the github-mirror workflow and the release job use. Nothing is
# printed. Afterwards you can delete the .pem file (a new key can be generated on the app's page at any time).
# Running it again replaces both secrets (e.g. with a new key).
set -euo pipefail
cd "$(dirname "$0")/.."

app_id="${1:?usage: github-setup.sh <app id> <private key .pem file>}"
pem="${2:?usage: github-setup.sh <app id> <private key .pem file>}"
[ -f "$pem" ] || { echo "$pem: no such file" >&2; exit 1; }
github_repo="${GITHUB_REPO:-MariusEng/notepad}"
url="${FORGEJO_URL:-https://git.1011.no}"
repo="${FORGEJO_REPO:-marius/notepad}"
api="$url/api/v1/repos/$repo"
FORGEJO_TOKEN=$(printf 'protocol=https\nhost=%s\n\n' "${url#https://}" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
[ -n "$FORGEJO_TOKEN" ] || { echo "No git.1011.no sign-in found (git credential helper)." >&2; exit 1; }
auth=(-H "Authorization: token $FORGEJO_TOKEN")

export GH_APP_ID="$app_id" GH_APP_PRIVATE_KEY="$(cat "$pem")" GITHUB_REPO="$github_repo"
# What an installation token may do is in the token itself (GitHub's repository "permissions" field is only
# filled in for user tokens).
perms=$(bash scripts/github-token.sh --permissions)
case " $perms " in
  *" contents=write "*) ;;
  *) echo "The app's token for $github_repo has: ${perms:-no permissions}. It needs contents=write: set Contents to Read and write on the app, then accept the new permissions on the installation (Settings → Applications)." >&2; exit 1 ;;
esac
case " $perms " in
  *" workflows=write "*) ;;
  *) echo "Note: without Workflows: Read and write, commits that change .github/workflows can't be copied to GitHub." ;;
esac
echo "The app can push to $github_repo ($perms)."

secret() {
  local body
  body=$(V="$2" python3 -c "import json,os; print(json.dumps({'data': os.environ['V']}))")
  curl -fsS -X PUT "${auth[@]}" -H "Content-Type: application/json" -d "$body" "$api/actions/secrets/$1" >/dev/null
  echo "Forgejo secret $1 set"
}
secret GH_APP_ID "$GH_APP_ID"
secret GH_APP_PRIVATE_KEY "$GH_APP_PRIVATE_KEY"

# An older setup used a push mirror with a token: remove it.
for name in $(curl -fsS "${auth[@]}" "$api/push_mirrors" |
  python3 -c "import json,sys; [print(m['remote_name']) for m in json.load(sys.stdin) if 'github.com' in m['remote_address']]"); do
  curl -fsS -X DELETE "${auth[@]}" "$api/push_mirrors/$name" >/dev/null && echo "removed old push mirror $name"
done
echo "Done. The next push to git.1011.no is copied to GitHub (workflow github-mirror)."
