#!/usr/bin/env bash
# Attaches files to the Forgejo release for a tag, creating the release if it doesn't exist yet.
# Used by the `release` job of .forgejo/workflows/release.yml and by scripts/release-mac.sh:
#
#   scripts/forgejo-release.sh v0.12.0 file…
#
# Env: FORGEJO_TOKEN (default: from the git credential helper), FORGEJO_URL (default https://git.1011.no),
#      FORGEJO_REPO (default marius/notepad), FORGEJO_TARGET (commit to tag when the release is new; default: the
#      default branch), RELEASE_NOTES (text of a new release).
# An asset with the same name is replaced, so re-running a job is fine.
set -euo pipefail

tag="${1:?usage: forgejo-release.sh <tag> <file>...}"
shift
[ "$#" -gt 0 ] || { echo "no files to upload" >&2; exit 1; }
url="${FORGEJO_URL:-https://git.1011.no}"
if [ -z "${FORGEJO_TOKEN:-}" ]; then
  FORGEJO_TOKEN=$(printf 'protocol=https\nhost=%s\n\n' "${url#https://}" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
fi
: "${FORGEJO_TOKEN:?set FORGEJO_TOKEN}"
repo="${FORGEJO_REPO:-marius/notepad}"
api="$url/api/v1/repos/$repo"
auth=(-H "Authorization: token $FORGEJO_TOKEN")

json_field() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1','') if isinstance(d,dict) else '')"; }

release_id() {
  curl -fsS "${auth[@]}" "$api/releases/tags/$tag" 2>/dev/null | json_field id || true
}

id="$(release_id)"
if [ -z "$id" ]; then
  body=$(python3 -c "
import json,os,sys
r={'tag_name': sys.argv[1], 'name': 'Notepad ' + sys.argv[1].lstrip('v'),
   'body': os.environ.get('RELEASE_NOTES') or 'Built by Forgejo Actions. The macOS build is added from a Mac.'}
if os.environ.get('FORGEJO_TARGET'): r['target_commitish']=os.environ['FORGEJO_TARGET']
print(json.dumps(r))" "$tag")
  # Two jobs may race to create it: if creating fails, look it up again.
  id=$(curl -fsS "${auth[@]}" -H "Content-Type: application/json" -d "$body" "$api/releases" 2>/dev/null | json_field id || true)
  [ -n "$id" ] || id="$(release_id)"
fi
[ -n "$id" ] || { echo "could not find or create the release for $tag" >&2; exit 1; }

existing=$(curl -fsS "${auth[@]}" "$api/releases/$id/assets")
for f in "$@"; do
  name=$(basename "$f")
  old=$(printf '%s' "$existing" | python3 -c "import json,sys; print(next((str(a['id']) for a in json.load(sys.stdin) if a['name']==sys.argv[1]), ''))" "$name")
  if [ -n "$old" ]; then
    curl -fsS -X DELETE "${auth[@]}" "$api/releases/$id/assets/$old" >/dev/null
  fi
  echo "uploading $name"
  curl -fsS "${auth[@]}" -F "attachment=@$f" "$api/releases/$id/assets?name=$name" >/dev/null
done
