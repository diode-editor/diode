// Run: node --test scripts/ (npm run test:scripts).
// install.sh --method=binary end to end, offline: a fake curl "downloads" a fake binary,
// a fake ldd plays glibc or musl. Linux only, like the code paths under test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const SCRIPT = join(import.meta.dirname, "..", "install.sh");
const LINUX = process.platform === "linux";
const SHELL = existsSync("/usr/bin/dash") ? "/usr/bin/dash" : "sh";
const GLIBC_LDD_VERSION = "ldd (Debian GLIBC 2.36-9) 2.36";

let root = "";

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "install-sh-"));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function writeExecutable(path, body) {
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
}

/**
 * Runs install.sh with `binary` as the release asset. `ldd` is the fake ldd's reply to
 * `ldd <binary>`, `lddVersion` to `ldd --version`.
 */
function install({ binary, ldd = "", lddVersion = GLIBC_LDD_VERSION }) {
    const bin = join(root, "bin");
    const dir = join(root, "install");
    const curlCalls = join(root, "curl.log");
    spawnSync("mkdir", ["-p", bin]);
    writeFileSync(join(root, "asset"), binary);
    writeFileSync(join(root, "ldd.out"), ldd);
    writeFileSync(join(root, "ldd.version"), lddVersion);
    // curl -fsSL --retry 3 -o FILE URL: the asset itself, no checksum sidecar.
    writeExecutable(
        join(bin, "curl"),
        `out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; *) url="$1" ;; esac; shift; done
echo "$url" >> "${curlCalls}"
case "$url" in *.sha256) exit 22 ;; esac
cp "${join(root, "asset")}" "$out"`,
    );
    writeExecutable(
        join(bin, "ldd"),
        `if [ "$1" = --version ]; then cat "${join(root, "ldd.version")}"; else cat "${join(root, "ldd.out")}"; fi`,
    );
    const result = spawnSync(SHELL, [SCRIPT], {
        encoding: "utf8",
        env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            DIODE_INSTALL_DIR: dir,
            DIODE_INSTALL_METHOD: "binary",
        },
    });
    return {
        status: result.status,
        stderr: result.stderr,
        installed: join(dir, "diode"),
        downloaded: existsSync(curlCalls),
    };
}

function isDebianFamily() {
    if (!existsSync("/etc/os-release")) {
        return false;
    }
    return /^(ID|ID_LIKE)=.*(debian|ubuntu)/m.test(readFileSync("/etc/os-release", "utf8"));
}

const WORKING = 'echo "0.9.0"';
const NO_LIBATOMIC =
    'echo "diode: error while loading shared libraries: libatomic.so.1: cannot open shared object file: No such file or directory" >&2; exit 127';
const LDD_NO_LIBATOMIC = [
    "\tlinux-vdso.so.1 (0x0000ffff8a1c0000)",
    "\tlibatomic.so.1 => not found",
    "\tlibstdc++.so.6 => /lib/aarch64-linux-gnu/libstdc++.so.6 (0x0000ffff89f00000)",
    "",
].join("\n");

test("install.sh: a binary that starts is reported as installed with its version", { skip: !LINUX }, () => {
    const run = install({ binary: `#!/bin/sh\n${WORKING}\n` });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stderr, /> Installed .*\/install\/diode\n> diode 0\.9\.0\n/);
});

test("install.sh: a missing libatomic fails, names the library and keeps the file", { skip: !LINUX }, () => {
    const run = install({ binary: `#!/bin/sh\n${NO_LIBATOMIC}\n`, ldd: LDD_NO_LIBATOMIC });
    assert.equal(run.status, 1, run.stderr);
    assert.doesNotMatch(run.stderr, /> Installed/);
    assert.match(run.stderr, /install\/diode is in place but does not start/);
    assert.match(run.stderr, /Missing shared libraries:\n {4}libatomic\.so\.1\n/);
    assert.doesNotMatch(run.stderr, /libstdc\+\+/);
    assert.equal(/sudo apt-get install libatomic1/.test(run.stderr), isDebianFamily(), run.stderr);
    assert.ok(existsSync(run.installed), "the binary stays in place for a retry without download");
});

test("install.sh: a start failure without missing libraries prints the binary's stderr", { skip: !LINUX }, () => {
    const run = install({ binary: '#!/bin/sh\necho "boom: bad things" >&2; exit 3\n' });
    assert.equal(run.status, 1, run.stderr);
    assert.doesNotMatch(run.stderr, /> Installed/);
    assert.doesNotMatch(run.stderr, /Missing shared libraries/);
    assert.match(run.stderr, /--version failed with:\nboom: bad things\n/);
    assert.ok(existsSync(run.installed));
});

test("install.sh: musl libc is refused before any download", { skip: !LINUX }, () => {
    const run = install({ binary: `#!/bin/sh\n${WORKING}\n`, lddVersion: "musl libc (aarch64)\nVersion 1.2.5" });
    assert.equal(run.status, 1, run.stderr);
    assert.match(
        run.stderr,
        /musl libc \(e\.g\. Alpine\) is not supported: Diode builds need glibc\. Use a glibc-based distro or --method=npm/,
    );
    assert.equal(run.downloaded, false);
    assert.equal(existsSync(run.installed), false);
});
