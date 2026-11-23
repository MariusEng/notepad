#!/usr/bin/env bash
# Runs a command (a macOS build) with Notepad's own code signing certificate available, so the app is signed with a
# fixed identity instead of ad hoc. macOS keychain access ("Always Allow") is tied to that identity, so updates no
# longer ask for keychain access again. Not an Apple certificate: Gatekeeper still treats the app as unidentified.
#
#   scripts/with-signing-keychain.sh npx tauri build --bundles app,dmg
#
# The certificate (.p12, base64) and its password come from MACOS_SIGNING_P12 / MACOS_SIGNING_P12_PASSWORD (CI
# secrets), or on this Mac from the login keychain items made by scripts/macos-signing-setup.sh. Without them the
# command runs as it is (ad-hoc signing, as before).
#
# A temporary keychain holds the certificate for the command only; it is removed afterwards. It is NOT added to the
# keychain search list (that didn't reach codesign for the CI runner's background user): a `codesign` wrapper first in
# PATH names the keychain when signing (Tauri runs plain `codesign`).
set -euo pipefail

p12="${MACOS_SIGNING_P12:-}"
pw="${MACOS_SIGNING_P12_PASSWORD:-}"
if [ -z "$p12" ] && command -v security >/dev/null; then
  p12=$(security find-generic-password -s notepad-macos-signing-p12 -w 2>/dev/null || true)
  pw=$(security find-generic-password -s notepad-macos-signing-p12-password -w 2>/dev/null || true)
fi
if [ -z "$p12" ] || [ -z "$pw" ]; then
  echo "No Notepad signing certificate (see scripts/macos-signing-setup.sh): building with ad-hoc signing"
  exec "$@"
fi

work=$(mktemp -d)
kc="$work/notepad-signing.keychain-db"
kcpw=$(openssl rand -hex 16)

cleanup() {
  security delete-keychain "$kc" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

setup() {
  umask 077
  printf '%s' "$p12" | base64 -d >"$work/cert.p12"
  security create-keychain -p "$kcpw" "$kc"
  security set-keychain-settings -t 3600 -u "$kc"
  security unlock-keychain -p "$kcpw" "$kc"
  security import "$work/cert.p12" -k "$kc" -P "$pw" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$kcpw" "$kc" >/dev/null
  rm -f "$work/cert.p12"
  # codesign: when signing (-s/--sign), search only our keychain for the identity.
  mkdir -p "$work/bin"
  cat >"$work/bin/codesign" <<WRAP
#!/bin/sh
for a in "\$@"; do
  case "\$a" in -s|--sign) exec /usr/bin/codesign --keychain "$kc" "\$@" ;; esac
done
exec /usr/bin/codesign "\$@"
WRAP
  chmod +x "$work/bin/codesign"
  # The certificate isn't trusted as an Apple one ("CSSMERR_TP_NOT_TRUSTED"), which codesign accepts; take its hash.
  identity=$(security find-identity -p codesigning "$kc" | awk '/^ *1\)/ {print $2; exit}')
  [ -n "$identity" ]
}

identity=""
if ! (set -e; setup) || ! identity=$(security find-identity -p codesigning "$kc" 2>/dev/null | awk '/^ *1\)/ {print $2; exit}') || [ -z "$identity" ]; then
  # Don't hold up a release: build as before and say so (the keychain question then comes back after this update).
  echo "::warning::Couldn't set up the signing certificate: building with ad-hoc signing"
  cleanup
  trap - EXIT
  exec "$@"
fi
echo "Signing with Notepad's certificate ($identity)"
PATH="$work/bin:$PATH" APPLE_SIGNING_IDENTITY="$identity" "$@"
