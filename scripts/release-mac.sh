#!/usr/bin/env bash
# Builds the macOS app (Apple Silicon .dmg) here and attaches it to the release of the current version, which the
# Forgejo workflow creates when a push to main builds green. Run it on the Mac after that release exists:
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
