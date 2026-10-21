#!/usr/bin/env node
// npm run git:push [-- <branch>] [--expect <sha>]: push a branch over https.
//
// Https only (origin is ssh, which only works with a forwarded agent). Overwrites go
// only through `--force-with-lease=refs/heads/<b>:<sha>` with an EXPLICIT SHA: pushing to a URL
// without one leaves the lease nothing to compare with, and it silently becomes --force.
//
// The lease SHA (in order): --expect; the git:stack-rebase record (taken BEFORE the rewrite);
// the server, only if the local branch continues it or the branch is absent. A mismatch
// without a record is refused: it is someone else's push or a manual rebase.
import {
    assertDiodeCheckout,
    currentBranch,
    die,
    dropLease,
    git,
    gitOk,
    isAncestor,
    loadLease,
    loud,
    remoteSha,
    REPO_URL,
    short,
} from "./lib.mjs";

assertDiodeCheckout();

const argv = process.argv.slice(2);
let branch;
let expect;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--expect") expect = argv[++i];
    else if (a.startsWith("--expect=")) expect = a.slice(9);
    else if (a === "--help" || a === "-h") {
        console.log("Usage: npm run git:push -- [<branch>] [--expect <server-sha>]");
        process.exit(0);
    } else if (!a.startsWith("-") && branch === undefined) branch = a;
    else die(`git:push: unknown argument "${a}"`, 2);
}
branch ??= currentBranch();
if (branch === "main") die("No direct pushes to main: only through a PR.");
if (!gitOk("rev-parse", "-q", "--verify", `refs/heads/${branch}`)) die(`No local branch ${branch}.`);

const local = git("rev-parse", `refs/heads/${branch}`);
const server = remoteSha(branch) ?? "";
const recorded = loadLease(branch);

let lease;
if (expect !== undefined) {
    lease = expect === "" ? "" : git("rev-parse", expect);
    if (lease !== server) {
        die(
            `${branch} on the server is ${short(server) || "(none)"}, but you expect ${short(lease) || "(none)"}: not overwriting.`,
        );
    }
} else if (recorded !== undefined) {
    lease = recorded;
    if (recorded !== server) {
        die(`Before the rebase the server had ${short(recorded) || "(no branch)"}, now ${short(server) || "(no branch)"}:
someone pushed to ${branch} since. Take a look (npm run git:fetch -- ${branch} && git log ${branch}..origin/${branch}) and, to overwrite deliberately,
pass --expect ${server}.`);
    }
} else if (server === "" || server === local || isAncestor(server, local)) {
    lease = server;
} else {
    die(`${branch}: the local branch does not continue the server one (${short(server)}), and there is no git:stack-rebase record.
If you rewrote the history and need to overwrite the server, retry with --expect ${server}.`);
}

if (server === local) {
    console.log(`${branch} on the server is already ${short(local)}: nothing to push.`);
    process.exit(0);
}
const code = loud("git", [
    "push",
    `--force-with-lease=refs/heads/${branch}:${lease}`,
    REPO_URL,
    `refs/heads/${branch}:refs/heads/${branch}`,
]);
if (code !== 0) process.exit(code);

dropLease(branch);
// A push to a URL does not move the remote-tracking ref.
git("update-ref", `refs/remotes/origin/${branch}`, local);
console.log(`${branch}: ${short(server) || "(new)"} → ${short(local)}. PR status: npm run git:pr-status`);
