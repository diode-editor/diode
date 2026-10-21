#!/usr/bin/env bash
# One-off: the apt repository signing key.
#
#   packaging/apt/gen-key.sh [out-dir]          (default ~/diode-apt-key)
#
# 1. Generates an ed25519 "sign only, no expiry" key in the CURRENT keyring
#    ($GNUPGHOME or ~/.gnupg); it stays there as a backup. pinentry asks for the passphrase.
# 2. Exports into <out-dir>:
#      apt-signing-key.private.asc — the private half (armored), chmod 600
#      apt-signing-key.public.asc  — the public half, for reference (CI ships it to the release itself)
# 3. Prints the base64 of the private half on one line: the value of the
#    APT_GPG_PRIVATE_KEY secret (release.yml decodes it back). The key passphrase is
#    a separate APT_GPG_PASSPHRASE secret.
#
# No expiry on purpose: apt refuses `update` with an expired key, and there is no way
# to update the keyring of every user. Losing the key = a new keyring for everyone,
# so the base64 and the passphrase go into a password manager.
#
# Non-interactive mode (tests): DIODE_KEY_PASSPHRASE=<passphrase>, no pinentry.

set -euo pipefail

out="${1:-$HOME/diode-apt-key}"
uid="Diode apt repository <noreply@diode-editor.github.io>"

if gpg --batch --list-secret-keys "$uid" >/dev/null 2>&1; then
    echo "gen-key.sh: key \"$uid\" is already in the keyring; exporting it instead of creating a new one" >&2
else
    if [[ -n "${DIODE_KEY_PASSPHRASE:-}" ]]; then
        gpg --batch --quiet --pinentry-mode loopback --passphrase "$DIODE_KEY_PASSPHRASE" \
            --quick-gen-key "$uid" ed25519 sign 0
    else
        gpg --quiet --quick-gen-key "$uid" ed25519 sign 0
    fi
fi

mkdir -p "$out"
chmod 700 "$out"
if [[ -n "${DIODE_KEY_PASSPHRASE:-}" ]]; then
    gpg --batch --pinentry-mode loopback --passphrase "$DIODE_KEY_PASSPHRASE" \
        --armor --export-secret-keys "$uid" > "$out/apt-signing-key.private.asc"
else
    gpg --armor --export-secret-keys "$uid" > "$out/apt-signing-key.private.asc"
fi
chmod 600 "$out/apt-signing-key.private.asc"
gpg --batch --armor --export "$uid" > "$out/apt-signing-key.public.asc"

fpr="$(gpg --batch --list-keys --with-colons "$uid" | awk -F: '$1=="fpr"{print $10; exit}')"

{
    echo "Key:         $fpr"
    echo "Private:     $out/apt-signing-key.private.asc"
    echo "Public:      $out/apt-signing-key.public.asc"
    echo
    echo "Repository secrets:"
    echo "  gh secret set APT_GPG_PRIVATE_KEY --repo diode-editor/diode < $out/apt-signing-key.private.b64"
    echo "  gh secret set APT_GPG_PASSPHRASE  --repo diode-editor/diode   # prompts for the passphrase"
    echo
    echo "APT_GPG_PRIVATE_KEY (base64, one line; also written to $out/apt-signing-key.private.b64):"
} >&2

base64 < "$out/apt-signing-key.private.asc" | tr -d '\n' > "$out/apt-signing-key.private.b64"
chmod 600 "$out/apt-signing-key.private.b64"
cat "$out/apt-signing-key.private.b64"
echo
