#!/usr/bin/env bash
# Publishes a GitHub Release (https://github.com/MariusEng/notepad/releases) with the given files, creating it if
# needed; an asset with the same name is replaced, so re-running is fine. Used by the release job.
#
#   scripts/github-release.sh v0.16.1 file…
#
# Credentials: GH_APP_ID + GH_APP_PRIVATE_KEY (the GitHub App, as in CI; see github-token.sh), else the GitHub CLI's
# sign-in (`gh auth token`, for scripts/release-mac.sh on the Mac); neither → message, exit 0.
# Env:
#      GITHUB_REPO (default MariusEng/notepad), RELEASE_TARGET (commit to tag if GitHub doesn't have the tag yet:
#      the push mirror may not have pushed it yet), RELEASE_NOTES (text of a new release).
set -euo pipefail

tag="${1:?usage: github-release.sh <tag> <file>...}"
shift
[ "$#" -gt 0 ] || { echo "no files to upload" >&2; exit 1; }
if [ -n "${GH_APP_ID:-}" ] && [ -n "${GH_APP_PRIVATE_KEY:-}" ]; then
  GH_RELEASE_TOKEN=$(bash "$(dirname "$0")/github-token.sh")
elif command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  GH_RELEASE_TOKEN=$(gh auth token)
else
  echo "No GitHub App secrets (GH_APP_ID, GH_APP_PRIVATE_KEY) or gh sign-in: not publishing on GitHub"
  exit 0
fi
repo="${GITHUB_REPO:-MariusEng/notepad}"
api="https://api.github.com/repos/$repo"
auth=(-H "Authorization: Bearer $GH_RELEASE_TOKEN" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

json_field() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1','') if isinstance(d,dict) else '')"; }

# A new release starts as a draft and is published after its files are uploaded, so it never shows as "latest"
# without latest.json (the app's updater reads releases/latest/download/latest.json). Drafts aren't found by tag, so
# look through the recent releases (also finds a draft left by a failed run).
id=$(curl -fsS "${auth[@]}" "$api/releases?per_page=30" |
  python3 -c "import json,sys; print(next((str(r['id']) for r in json.load(sys.stdin) if r['tag_name']==sys.argv[1]), ''))" "$tag")
if [ -z "$id" ]; then
  body=$(python3 -c "
import json,os,sys
r={'tag_name': sys.argv[1], 'name': 'Notepad ' + sys.argv[1].lstrip('v'), 'body': os.environ.get('RELEASE_NOTES', ''), 'draft': True}
if os.environ.get('RELEASE_TARGET'): r['target_commitish']=os.environ['RELEASE_TARGET']
print(json.dumps(r))" "$tag")
  id=$(curl -fsS "${auth[@]}" -d "$body" "$api/releases" | json_field id)
fi
[ -n "$id" ] || { echo "could not find or create the GitHub release for $tag" >&2; exit 1; }

existing=$(curl -fsS "${auth[@]}" "$api/releases/$id/assets?per_page=100")
for f in "$@"; do
  name=$(basename "$f")
  old=$(printf '%s' "$existing" | python3 -c "import json,sys; print(next((str(a['id']) for a in json.load(sys.stdin) if a['name']==sys.argv[1]), ''))" "$name")
  [ -z "$old" ] || curl -fsS -X DELETE "${auth[@]}" "$api/releases/assets/$old" >/dev/null
  echo "uploading $name to GitHub"
  enc=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))" "$name")
  curl -fsS "${auth[@]}" -H "Content-Type: application/octet-stream" --data-binary "@$f" \
    "https://uploads.github.com/repos/$repo/releases/$id/assets?name=$enc" >/dev/null
done
draft=$(curl -fsS "${auth[@]}" "$api/releases/$id" | json_field draft)
if [ "$draft" = "True" ]; then
  curl -fsS -X PATCH "${auth[@]}" -d '{"draft": false, "make_latest": "true"}' "$api/releases/$id" >/dev/null
  echo "published"
fi
echo "https://github.com/$repo/releases/tag/$tag"
