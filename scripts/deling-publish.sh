#!/usr/bin/env bash
# Publishes a Notepad release on https://deling.1011.no/notepad (the page friends download from).
#
#   scripts/deling-publish.sh <version> <readme.md> <file>...
#
# A new release with the same slug replaces the previous one there completely (files can't be added later), so
# always pass every file of the version. The API only answers on the LAN/Tailscale and needs a token:
#   - CI: the Actions secret DELING_TOKEN,
#   - this Mac: DELING_TOKEN in the environment, or the keychain item "deling-api-token"
#     (security add-generic-password -s deling-api-token -a deling -w '<token>').
# Without a token it says so and exits 0, so a release elsewhere isn't held up by it.
#
# Optional: DELING_SLUG (default notepad), DELING_NAME (default Notepad), DELING_PASSWORD (protects the page; deling
# refuses an empty one, and a slug that moves keeps its password when none is given). Used by the managed edition.
set -euo pipefail

version="${1:?usage: deling-publish.sh <version> <readme> <file>...}"
readme="${2:?readme}"
shift 2
[ "$#" -gt 0 ] || { echo "no files to publish" >&2; exit 1; }

token="${DELING_TOKEN:-}"
if [ -z "$token" ] && command -v security >/dev/null; then
  token=$(security find-generic-password -s deling-api-token -w 2>/dev/null || true)
fi
if [ -z "$token" ]; then
  echo "deling: no token (DELING_TOKEN secret / keychain item deling-api-token), not publishing on deling.1011.no"
  exit 0
fi

args=()
for f in "$@"; do
  name=$(basename "$f")
  [[ "$name" =~ ^[A-Za-z0-9._+-]+$ ]] || { echo "deling: file name not allowed: $name" >&2; exit 1; }
  args+=(-F "file=@$f")
done

# --form-string: values are sent as they are (no @file / <file interpretation).
out=$(curl -fsS --retry 2 -H "Authorization: Bearer $token" \
  --form-string "name=${DELING_NAME:-Notepad}" \
  --form-string "version=$version" \
  --form-string "slug=${DELING_SLUG:-notepad}" \
  ${DELING_PASSWORD:+--form-string "password=$DELING_PASSWORD"} \
  -F "readme=@$readme" \
  "${args[@]}" \
  "${DELING_URL:-https://deling.1011.no}/api/releases")
printf '%s' "$out" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('deling:', d.get('url'))
for f in d.get('files', []): print('  ', f.get('url'), f.get('sha256', '')[:16])"
