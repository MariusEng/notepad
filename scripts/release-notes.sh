#!/usr/bin/env bash
# Text for releases, from CHANGELOG.md (add a section for every version, in the same commit as the version bump).
#
#   scripts/release-notes.sh section v0.14.1   the changes of one version (empty if it has no section)
#   scripts/release-notes.sh deling v0.14.1    the README for deling.1011.no/notepad: intro, downloads and the
#                                              whole changelog, so the page grows with every release
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:?usage: release-notes.sh section|deling <version>}"
version="${2:?version}"
version="${version#v}"

# The lines under "## <version> …" up to the next "## " heading.
section() {
  awk -v v="$1" '
    /^## / { inside = ($2 == v); next }
    inside { print }
  ' CHANGELOG.md | sed -e '/./,$!d' # drop leading blank lines
}

downloads() {
  cat <<'EOF'
## Downloads

- **Windows**: `Notepad_*_x64-setup.exe`. Not signed: if SmartScreen warns, click *More info* → *Run anyway*.
- **macOS** (Apple Silicon): `.dmg`. Not notarised: the first time, macOS says it can't check the app; click Done,
  then System Settings → Privacy & Security → **Open Anyway**.
- **Linux**: `.deb` (Debian/Ubuntu), `.rpm` (Fedora/openSUSE) or `.AppImage` (any distribution).
EOF
}

case "$mode" in
  section)
    section "$version"
    ;;
  deling)
    echo "# Notepad $version"
    echo
    echo "A minimal notepad for macOS, Windows and Linux. Markdown is the default: you edit formatted text, and the"
    echo "file on disk stays plain \`.md\`. Also for code, JSON, XML, CSV and logs, with git built in."
    echo
    downloads
    echo
    echo "## Changelog"
    echo
    # Every version, newest first, one heading level down.
    sed -n '/^## /,$p' CHANGELOG.md | sed 's/^## /### /'
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 1
    ;;
esac
