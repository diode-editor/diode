#!/usr/bin/env bash
# A flat apt repository on top of GitHub Releases.
#
#   packaging/apt/build-repo.sh <dir with *.deb> [gpg-key-id]
#   APT_HISTORY=<file> packaging/apt/build-repo.sh …   # + entries of past releases (fetch-history.sh)
#
# Writes Packages, Packages.gz, Release, InRelease, Release.gpg and
# diode-archive-keyring.gpg next to the .deb files. All of them are uploaded as assets to the
# same release, and the user's sources.list has:
#
#   deb [signed-by=/etc/apt/keyrings/diode.gpg] https://github.com/diode-editor/diode/releases/latest/download ./
#
# apt requests <base>/InRelease and <base>/Packages, and Filename in Packages is the .deb name
# relative to the same base: GitHub answers with a redirect to its CDN, and apt follows it.
# GitHub's "latest" is the latest NON-pre-release, so nightly never lands here.
#
# Past versions: APT_HISTORY is a file of stanzas from fetch-history.sh whose Filename points
# through `../../download/vX/` into their own releases. Appended after the stanzas of the local .deb files.
#
# Key: in CI the private key comes from the APT_GPG_PRIVATE_KEY secret (armored);
# the key id is optional, the first secret signing key in the keyring is used.

set -euo pipefail

dir="${1:?dir with .deb files}"
key="${2:-}"

cd "$dir"
ls ./*.deb >/dev/null 2>&1 || { echo "no .deb files in $dir" >&2; exit 1; }

# Filename must be a bare file name (no ./): apt concatenates base URL + Filename.
dpkg-scanpackages --multiversion . /dev/null | sed 's|^Filename: \./|Filename: |' > Packages
if [[ -n "${APT_HISTORY:-}" ]]; then
    # dpkg-scanpackages ends the last stanza with a blank line, so the separator is already there.
    cat "$APT_HISTORY" >> Packages
fi
gzip -9 -k -f Packages

apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=Diode \
    -o APT::FTPArchive::Release::Label=Diode \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
    -o APT::FTPArchive::Release::Description="Diode terminal editor, flat repository on GitHub Releases" \
    release . > Release

# Signing key: the first one whose secret part is actually present (field 15 != "#") and
# whose capabilities include signing (field 12 contains "s"). This works both for a dedicated
# key (gen-key.sh) and for a signing subkey of a personal key exported on its own
# (`gpg --export-secret-subkeys <subkey>!`): for the latter the primary is marked as missing
# in the keyring, and `--local-user <primary>` would fail.
if [[ -z "$key" ]]; then
    key="$(gpg --batch --list-secret-keys --with-colons \
        | awk -F: '($1=="sec" || $1=="ssb") && $15!="#" && $12 ~ /s/ {print $5; exit}')"
fi
[[ -n "$key" ]] || { echo "no secret gpg key with signing capability available" >&2; exit 1; }

# The key passphrase (if any) comes from APT_GPG_PASSPHRASE; otherwise the key must have none.
sign=(gpg --batch --yes --local-user "${key}!" --digest-algo SHA256)
if [[ -n "${APT_GPG_PASSPHRASE:-}" ]]; then
    sign+=(--pinentry-mode loopback --passphrase-fd 3)
    exec 3< <(printf '%s' "$APT_GPG_PASSPHRASE")
fi

"${sign[@]}" --clearsign -o InRelease Release
if [[ -n "${APT_GPG_PASSPHRASE:-}" ]]; then exec 3< <(printf '%s' "$APT_GPG_PASSPHRASE"); fi
"${sign[@]}" --detach-sign --armor -o Release.gpg Release
gpg --batch --yes --export "$key" > diode-archive-keyring.gpg

echo "apt repo metadata written to $dir (key $key)"
