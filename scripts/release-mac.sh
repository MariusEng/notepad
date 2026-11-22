#!/usr/bin/env bash
# Builds the macOS app (Apple Silicon .dmg) here and attaches it to the release of the current version, which the
# Forgejo workflow creates when a push to main builds green, then publishes all files of that version (Linux,
# Windows and this dmg) on deling.1011.no/notepad (needs the token, see deling-publish.sh). Run it on the Mac after
# that release exists:
#
#   scripts/release-mac.sh            # version from package.json
#   scripts/release-mac.sh v0.12.0    # another tag (check out that commit first)
#
# Uses your git credentials for git.1011.no. The build is not code-signed (by choice).
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p 'require("./package.json").version')
tag="${1:-v$version}"
[ "$tag" = "v$version" ] || { echo "package.json is $version but you asked for $tag: check out $tag first" >&2; exit 1; }

url="${FORGEJO_URL:-https://git.1011.no}"
repo="${FORGEJO_REPO:-marius/notepad}"
token=$(printf 'protocol=https\nhost=%s\n\n' "${url#https://}" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: token $token" "$url/api/v1/repos/$repo/releases/tags/$tag")
if [ "$code" != "200" ]; then
  echo "There is no release $tag yet. Push to main and wait for the workflow to finish green, then run this again." >&2
  exit 1
fi

npx tauri build --bundles app,dmg
dmg=$(ls src-tauri/target/release/bundle/dmg/Notepad_"${version}"_*.dmg)
FORGEJO_TOKEN="$token" scripts/forgejo-release.sh "$tag" "$dmg"
echo "Attached $(basename "$dmg") to $url/$repo/releases/tag/$tag"

# deling.1011.no replaces a release as a whole, so publish every file of this version there again, now with the dmg.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl -fsS -H "Authorization: token $token" "$url/api/v1/repos/$repo/releases/tags/$tag" >"$work/release.json"
python3 - "$work" <<'PY'
import json, sys
work = sys.argv[1]
r = json.load(open(f"{work}/release.json"))
with open(f"{work}/assets.txt", "w") as f:
    for a in r["assets"]:
        f.write(f"{a['name']}\t{a['browser_download_url']}\n")
PY
mkdir -p "$work/files"
while IFS=$'\t' read -r name dl; do
  curl -fsSL -H "Authorization: token $token" -o "$work/files/$name" "$dl"
done <"$work/assets.txt"
scripts/release-notes.sh deling "$tag" >"$work/README.md"
scripts/deling-publish.sh "$tag" "$work/README.md" "$work"/files/*
