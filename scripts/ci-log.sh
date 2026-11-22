#!/usr/bin/env bash
# Build logs from Forgejo Actions, kept as assets of a draft release named "CI logs" (this Forgejo has no API for job
# logs, and a draft release creates no git tag). Readable by anyone with access to the repository.
#
#   scripts/ci-log.sh upload <file> <name>   (in a workflow: FORGEJO_TOKEN, FORGEJO_URL, FORGEJO_REPO)
#   scripts/ci-log.sh list                   (on your machine: the token comes from the git credential helper)
#   scripts/ci-log.sh get <name> [dest]      e.g. scripts/ci-log.sh get run3-windows-failure.log
#
# Keeps the newest 40 logs.
set -euo pipefail

url="${FORGEJO_URL:-https://git.1011.no}"
repo="${FORGEJO_REPO:-marius/notepad}"
api="$url/api/v1/repos/$repo"
if [ -z "${FORGEJO_TOKEN:-}" ]; then
  host="${url#https://}"
  FORGEJO_TOKEN=$(printf 'protocol=https\nhost=%s\n\n' "$host" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
fi
[ -n "$FORGEJO_TOKEN" ] || { echo "no token (set FORGEJO_TOKEN)" >&2; exit 1; }
auth=(-H "Authorization: token $FORGEJO_TOKEN")
TITLE="CI logs"

release_id() {
  curl -fsS "${auth[@]}" "$api/releases?draft=true&limit=50" |
    python3 -c "import json,sys; print(next((str(r['id']) for r in json.load(sys.stdin) if r['name']==sys.argv[1] and r['draft']), ''))" "$TITLE"
}

assets() { curl -fsS "${auth[@]}" "$api/releases/$1/assets"; }

case "${1:-}" in
  upload)
    file="${2:?file}"; name="${3:?name}"
    id="$(release_id)"
    if [ -z "$id" ]; then
      body=$(python3 -c "import json,sys; print(json.dumps({'tag_name':'ci-logs','name':sys.argv[1],'draft':True,'body':'Build logs from Forgejo Actions (scripts/ci-log.sh). Not a release.'}))" "$TITLE")
      id=$(curl -fsS "${auth[@]}" -H "Content-Type: application/json" -d "$body" "$api/releases" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null || true)
      [ -n "$id" ] || id="$(release_id)" # the other job created it meanwhile
    fi
    [ -n "$id" ] || { echo "could not create the CI logs release" >&2; exit 1; }
    list="$(assets "$id")"
    # Replace one with the same name, and drop the oldest beyond 40.
    printf '%s' "$list" | python3 -c "
import json,sys
a=sorted(json.load(sys.stdin), key=lambda x: x['created_at'])
drop=[x['id'] for x in a if x['name']==sys.argv[1]] + [x['id'] for x in a[:-39] if x['name']!=sys.argv[1]]
print('\n'.join(map(str, drop)))" "$name" | while read -r old; do
      if [ -n "$old" ]; then curl -fsS -X DELETE "${auth[@]}" "$api/releases/$id/assets/$old" >/dev/null; fi
    done
    curl -fsS "${auth[@]}" -F "attachment=@$file;type=text/plain" "$api/releases/$id/assets?name=$name" >/dev/null
    echo "log uploaded as $name"
    ;;
  list)
    id="$(release_id)"; [ -n "$id" ] || { echo "no logs yet"; exit 0; }
    assets "$id" | python3 -c "
import json,sys
for a in sorted(json.load(sys.stdin), key=lambda x: x['created_at']): print(a['created_at'][:16], a['size'], a['name'])"
    ;;
  get)
    name="${2:?name}"; dest="${3:-$name}"
    id="$(release_id)"; [ -n "$id" ] || { echo "no logs yet" >&2; exit 1; }
    dl=$(assets "$id" | python3 -c "import json,sys; print(next((a['browser_download_url'] for a in json.load(sys.stdin) if a['name']==sys.argv[1]), ''))" "$name")
    [ -n "$dl" ] || { echo "no log named $name" >&2; exit 1; }
    curl -fsSL "${auth[@]}" -o "$dest" "$dl"
    echo "$dest"
    ;;
  *)
    sed -n '2,10p' "$0"; exit 1 ;;
esac
