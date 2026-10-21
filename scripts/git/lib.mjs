// Shared helpers for `npm run git:*` (docs/GIT.md#стек-pr-rebase-и-push).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** origin in checkouts is ssh, which only works with a forwarded agent, so network calls go over https. */
// DIODE_GIT_URL overrides it to test the helpers against a local bare repository.
export const REPO_URL = process.env.DIODE_GIT_URL ?? "https://github.com/diode-editor/diode.git";

/** Network calls use REPO_URL, not origin: run from a foreign clone, they would push its branches to diode. */
export function assertDiodeCheckout() {
    if (process.env.DIODE_GIT_URL !== undefined) return;
    const r = cap("git", ["remote", "get-url", "origin"], { allowFail: true });
    if (!r.ok || !/github\.com[:/]diode-editor\/diode(\.git)?$/.test(r.out)) {
        die(`origin of this checkout is "${r.out || "none"}", not diode-editor/diode: git:* only work in diode.`);
    }
}

export function die(msg, code = 1) {
    console.error(msg);
    process.exit(code);
}

export function cap(cmd, args, { allowFail = false, input } = {}) {
    const r = spawnSync(cmd, args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0 && !allowFail) {
        throw new Error(`${cmd} ${args.join(" ")}: ${(r.stderr || r.stdout).trim()}`);
    }
    return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

export function loud(cmd, args) {
    console.log(`> ${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (r.error) throw r.error;
    return r.status ?? 1;
}

export const git = (...args) => cap("git", args).out;
export const gitOk = (...args) => cap("git", args, { allowFail: true }).ok;

export function isAncestor(a, b) {
    return gitOk("merge-base", "--is-ancestor", a, b);
}

export function short(sha) {
    return sha.slice(0, 10);
}

/** `undefined` if the branch does not exist on the server. */
export function remoteSha(branch) {
    const out = git("ls-remote", REPO_URL, `refs/heads/${branch}`);
    return out === "" ? undefined : out.split(/\s+/)[0];
}

// Server SHA recorded by git:stack-rebase BEFORE history is rewritten: taken at push
// time, it would protect nothing in --force-with-lease.
function leaseFile(branch) {
    return path.join(git("rev-parse", "--git-common-dir"), "diode-push-lease", branch.replaceAll("/", "__"));
}

export function saveLease(branch, sha) {
    const file = leaseFile(branch);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${sha ?? ""}\n`);
}

/** `undefined` if nothing is recorded; `""` if the branch did not exist on the server when recorded. */
export function loadLease(branch) {
    try {
        return readFileSync(leaseFile(branch), "utf8").trim();
    } catch {
        return undefined;
    }
}

export function dropLease(branch) {
    rmSync(leaseFile(branch), { force: true });
}

export function currentBranch() {
    const b = git("branch", "--show-current");
    if (b === "") die("HEAD is detached: pass the branch explicitly.");
    return b;
}

export function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
