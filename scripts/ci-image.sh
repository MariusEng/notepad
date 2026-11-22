#!/usr/bin/env bash
# Builds the Linux CI image (ci/linux.Containerfile) and pushes it to git.1011.no's container registry, where the
# Linux job of .forgejo/workflows/release.yml pulls it from. Run it from the repository root on a machine with
# podman or docker (e.g. the server the Forgejo runner is on), after logging in once:
#
#   podman login git.1011.no          # user name + a token with package write access
#   scripts/ci-image.sh
#
# Rebuild it when the Rust or npm dependencies have changed a lot; older images keep working, just slower.
set -euo pipefail
cd "$(dirname "$0")/.."

image="${CI_IMAGE:-git.1011.no/marius/notepad-ci-linux}"
tool=$(command -v podman || command -v docker || true)
[ -n "$tool" ] || { echo "podman or docker is needed" >&2; exit 1; }

"$tool" build --platform linux/amd64 -f ci/linux.Containerfile -t "$image:latest" .
"$tool" push "$image:latest"
echo "Pushed $image:latest"
