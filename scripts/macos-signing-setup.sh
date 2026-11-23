#!/usr/bin/env bash
# One-time setup: creates Notepad's own macOS code signing certificate (self-signed, 20 years) and stores it where
# the builds find it (scripts/with-signing-keychain.sh). Run it in your own terminal:
#
#   scripts/macos-signing-setup.sh            (refuses if a certificate already exists)
#   scripts/macos-signing-setup.sh --replace  (a new certificate: macOS asks for keychain access once more)
#
# Stores, without printing them:
#   - Forgejo Actions secrets MACOS_SIGNING_P12 (base64 .p12) and MACOS_SIGNING_P12_PASSWORD (the CI's macOS build),
#   - the same in your login keychain (notepad-macos-signing-p12 / notepad-macos-signing-p12-password) as the backup
#     and for builds on this Mac (scripts/release-mac.sh).
# Keep the keychain backup: a new certificate means one more round of "allow keychain access" after the next update.
set -euo pipefail
cd "$(dirname "$0")/.."

if security find-generic-password -s notepad-macos-signing-p12 >/dev/null 2>&1 && [ "${1:-}" != "--replace" ]; then
  echo "A Notepad signing certificate already exists in your keychain. Use --replace to make a new one." >&2
  exit 1
fi

url="${FORGEJO_URL:-https://git.1011.no}"
repo="${FORGEJO_REPO:-marius/notepad}"
token=$(printf 'protocol=https\nhost=%s\n\n' "${url#https://}" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: token $token" "$url/api/v1/user")
if [ "$code" != 200 ]; then
  # The stored sign-in may need a refresh; a git command does that.
  git fetch -q origin 2>/dev/null || true
  token=$(printf 'protocol=https\nhost=%s\n\n' "${url#https://}" | git credential fill 2>/dev/null | sed -n 's/^password=//p')
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: token $token" "$url/api/v1/user")
fi
[ "$code" = 200 ] || { echo "Not signed in to ${url#https://} (try: git fetch), then run this again." >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
cat >"$work/cert.cnf" <<'CNF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = Notepad (self-signed)
O = Notepad
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
CNF
openssl req -x509 -newkey rsa:3072 -nodes -keyout "$work/key.pem" -out "$work/cert.pem" -days 7300 -config "$work/cert.cnf" 2>/dev/null
pw=$(openssl rand -hex 24)
# -legacy: the encryption macOS's `security import` reads (OpenSSL 3+); LibreSSL has no such option and is fine.
openssl pkcs12 -export -legacy -inkey "$work/key.pem" -in "$work/cert.pem" -out "$work/cert.p12" -passout "pass:$pw" -name "Notepad (self-signed)" 2>/dev/null ||
  openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" -out "$work/cert.p12" -passout "pass:$pw" -name "Notepad (self-signed)"
p12=$(base64 -i "$work/cert.p12" | tr -d '\n')

for pair in "MACOS_SIGNING_P12:p12" "MACOS_SIGNING_P12_PASSWORD:pw"; do
  name=${pair%%:*}
  var=${pair#*:}
  body=$(V="${!var}" python3 -c "import json,os; print(json.dumps({'data': os.environ['V']}))")
  curl -fsS -X PUT -H "Authorization: token $token" -H "Content-Type: application/json" -d "$body" \
    "$url/api/v1/repos/$repo/actions/secrets/$name" >/dev/null
  echo "Forgejo secret $name set"
done
security add-generic-password -U -a notepad -s notepad-macos-signing-p12 -l "Notepad macOS code signing certificate (.p12, base64)" -w "$p12"
security add-generic-password -U -a notepad -s notepad-macos-signing-p12-password -l "Notepad macOS code signing certificate password" -w "$pw"
echo "Backup stored in your login keychain"
echo "Certificate: $(openssl x509 -in "$work/cert.pem" -noout -subject | sed 's/^subject=//'), SHA-1 $(openssl x509 -in "$work/cert.pem" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')"
echo "Done. The next release is signed with it; after updating to it, choose Always Allow once more per keychain question."
