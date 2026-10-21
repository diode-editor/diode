#!/usr/bin/env bash
# Packages entries of all past stable releases, so apt sees more than the latest version.
#
#   packaging/apt/fetch-history.sh <out-file> [exclude-tag] [owner/repo]
#
# Every release since v0.4.0 carries a Packages asset. Only the stanza of its own version
# (Version = tag without `v`) is taken from it, and its bare Filename is rewritten into the path to that release's asset:
#
#   Filename: ../../download/v0.8.3/diode_0.8.3_amd64.deb
#
# The user's sources.list points at releases/latest/download/, and
# releases/latest/download/../../download/vX/… is releases/download/vX/…. apt concatenates
# base + Filename without normalizing and sends `..` as is; GitHub accepts such a path.
# The format spec asks for Filename without `.`/`..` ("should"), and strict mirroring tools
# may reject such entries, so only old versions get `..`, while the new one
# (build-repo.sh, dpkg-scanpackages) keeps the bare name: at worst a strict
# client doesn't see the history, but the latest version installs as before.
#
# Sizes and hashes come from the old Packages; the .deb files themselves aren't downloaded.
# Releases without Packages (before the apt key existed) are skipped. Rebuilt from scratch on
# every release, so a gap in one release is fixed by the next.

set -euo pipefail

out="${1:?output file}"
exclude="${2:-}"
repo="${3:-${GITHUB_REPOSITORY:-diode-editor/diode}}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
: > "$out"

# Nightly is a pre-release and never lands here, just as with releases/latest.
gh release list -R "$repo" --exclude-pre-releases --exclude-drafts --limit 1000 \
    --json tagName --jq '.[].tagName' |
while read -r tag; do
    [[ "$tag" == "$exclude" ]] && continue
    if ! gh release download "$tag" -R "$repo" -p Packages -O "$tmp" --clobber 2>/dev/null; then
        echo "skip $tag: no Packages asset" >&2
        continue
    fi
    awk -v RS= -v ORS='\n\n' -v ver="${tag#v}" -v tag="$tag" '
        {
            if ($0 !~ ("(^|\n)Version: " ver "(\n|$)")) next
            n = split($0, lines, "\n"); s = ""
            for (i = 1; i <= n; i++) {
                l = lines[i]
                if (l ~ /^Filename: [^\/]+$/) sub(/^Filename: /, "Filename: ../../download/" tag "/", l)
                s = s l (i < n ? "\n" : "")
            }
            print s
        }' "$tmp" >> "$out"
    echo "history: $tag" >&2
done
