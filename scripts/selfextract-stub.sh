#!/bin/sh
# diode — self-extracting executable.
#
# This file is the stub followed by payload.tar.gz (node + main.cjs + diode.bundle + lazy/*.cjs).
# Built by `scripts/build-selfextract.mjs`, which also fills in the @@...@@ placeholders.
# When editing the stub, remember: its length in bytes is the payload offset, so OFFSET depends
# on the text around it (the build script iterates to a fixed point). OFFSET must have no
# leading zeros: BSD tail on macOS reads such a number as octal.
#
# Why not Node SEA: injecting the SEA blob breaks Mach-O chained fixups on Intel macOS,
# a segfault before main() (see #143, #144). Here node stays an untouched binary from
# nodejs.org, with no Mach-O surgery, and the bug does not reproduce.
set -eu

OFFSET=@@OFFSET@@
KEY=@@KEY@@

CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}/diode"
DIR="$CACHE_ROOT/$KEY"

# Unpacking is idempotent and versioned: KEY = <version>-<payload sha>, so a new build
# gets a new directory instead of overwriting a live one. The .ready marker is written BEFORE
# the directory is published, so a half-unpacked state is never visible from outside.
if [ ! -f "$DIR/.ready" ]; then
    mkdir -p "$CACHE_ROOT"

    # mkdir is atomic, so it is the mutex. A naive `[ -d "$DIR" ] || mv "$TMP" "$DIR"`
    # does not work: mv into an EXISTING directory nests it inside instead of failing.
    if mkdir "$DIR.lock" 2>/dev/null; then
        TMP=$(mktemp -d "$CACHE_ROOT/.tmp-XXXXXX")
        trap 'rm -rf "$TMP" "$DIR.lock"' EXIT INT TERM

        # Read $0 before any cd: the kernel passes sh the path used in execve,
        # so launching via PATH works too.
        tail -c "+$OFFSET" "$0" | tar -xzf - -C "$TMP"
        : > "$TMP/.ready"

        rm -rf "$DIR"          # under the lock: the rename target must not exist
        mv "$TMP" "$DIR"       # rename(2) to a nonexistent path is atomic

        trap - EXIT INT TERM
        rm -rf "$DIR.lock"
    else
        # Someone else is unpacking right now; wait for their .ready.
        i=0
        while [ ! -f "$DIR/.ready" ] && [ "$i" -lt 300 ]; do
            sleep 0.1
            i=$((i + 1))
        done
        if [ ! -f "$DIR/.ready" ]; then
            echo "diode: timed out waiting for unpack." >&2
            echo "diode: if no other diode is starting, remove the stale lock: rm -rf '$DIR.lock'" >&2
            exit 1
        fi
    fi
fi

# exec replaces the process image: the kernel passes argv, the exit code and signals
# through directly, with no child process to babysit.
exec "$DIR/node" "$DIR/main.cjs" "$@"
