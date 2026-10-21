#!/usr/bin/env node
// npm run git:stack-rebase -- <branch> --base <old-base> [--dry-run]
//
// A PR stack after the base is squash-merged: the child branch sits on the parent's commits,
// while main got the parent as ONE squash commit with a different SHA. A plain
// `git rebase origin/main` replays the parent's commits again and drowns in
// conflicts with itself, so it needs `--onto`, cutting everything up to the old base:
//
//   git rebase --onto origin/main <old-base> <branch>
//
// <old-base> is the commit the branch sat on (the parent's head): a ref/SHA
// or the number of the merged PR (`#123` / `123`), whose headRefOid is used then.
//
// Before the rebase: a backup tag `backup/<branch>/<time>` (not a branch: rebase would
// carry it along via update-ref) and the server SHA of the branch for --force-with-lease in git:push.
import { assertDiodeCheckout, cap, die, git, gitOk, isAncestor, loud, remoteSha, saveLease, short } from "./lib.mjs";

assertDiodeCheckout();

function usage(code) {
    console.log(`Usage: npm run git:stack-rebase -- <branch> --base <old-base | #PR> [--onto <ref>] [--dry-run]

  <branch>       the child branch to move
  --base         where the branch sat: the parent's head (ref/SHA) or the merged PR number
  --onto         where to move it (default origin/main; run npm run git:fetch first)
  --dry-run      only show the plan`);
    process.exit(code);
}

const argv = process.argv.slice(2);
let branch;
let baseArg;
let onto = "origin/main";
let dryRun = false;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    else if (a === "--base") baseArg = argv[++i];
    else if (a.startsWith("--base=")) baseArg = a.slice(7);
    else if (a === "--onto") onto = argv[++i];
    else if (a.startsWith("--onto=")) onto = a.slice(7);
    else if (a === "--dry-run") dryRun = true;
    else if (!a.startsWith("-") && branch === undefined) branch = a;
    else die(`git:stack-rebase: unknown argument "${a}"`, 2);
}
if (branch === undefined || baseArg === undefined || onto === undefined) usage(2);
if (!gitOk("rev-parse", "-q", "--verify", `refs/heads/${branch}`)) die(`No local branch ${branch}.`);

let oldBase;
let squash;
const pr = /^#?(\d+)$/.exec(baseArg);
if (pr) {
    const info = JSON.parse(cap("gh", ["pr", "view", pr[1], "--json", "state,headRefOid,mergeCommit,headRefName"]).out);
    if (info.state !== "MERGED") die(`PR #${pr[1]} is ${info.state}, not MERGED: nothing to move onto.`);
    oldBase = info.headRefOid;
    squash = info.mergeCommit?.oid;
    if (!gitOk("cat-file", "-e", `${oldBase}^{commit}`)) {
        die(`The head of PR #${pr[1]} (${short(oldBase)}) is not available locally. Does branch ${branch} really sit on it?
If you have the parent branch ${info.headRefName}, pass it as --base.`);
    }
} else {
    if (!gitOk("rev-parse", "-q", "--verify", `${baseArg}^{commit}`)) die(`--base: unknown commit "${baseArg}".`);
    oldBase = git("rev-parse", `${baseArg}^{commit}`);
}
const ontoSha = git("rev-parse", `${onto}^{commit}`);
const head = git("rev-parse", branch);

// Refuse unless the base was squash-merged.
if (!isAncestor(oldBase, head)) {
    die(`${short(oldBase)} is not an ancestor of ${branch}: the branch does not sit on this base. Check --base.`);
}
if (isAncestor(oldBase, ontoSha)) {
    die(`${short(oldBase)} is already an ancestor of ${onto}: the base came in by a merge commit or fast-forward, not a squash.
No --onto needed here, a plain rebase is enough: git rebase ${onto} ${branch}`);
}
if (squash !== undefined && !isAncestor(squash, ontoSha)) {
    die(`The PR squash commit (${short(squash)}) is not in ${onto} yet. Update with npm run git:fetch and retry.`);
}
if (squash === undefined) {
    // A squash is one commit with the parent's total diff: look for the same patch-id. If
    // none matches, the diff was edited on merge, and naming the PR beats guessing.
    const fork = git("merge-base", oldBase, ontoSha);
    const patchId = (input) => cap("git", ["patch-id", "--stable"], { input }).out;
    const parentId = patchId(cap("git", ["diff", fork, oldBase]).out).split(/\s+/)[0];
    const ids = patchId(cap("git", ["log", "-p", "--no-merges", "--format=commit %H", `${fork}..${ontoSha}`]).out);
    const hit = ids
        .split("\n")
        .map((l) => l.split(/\s+/))
        .find(([id]) => id === parentId);
    if (hit === undefined) {
        die(`No squash commit with the parent's diff (${short(fork)}..${short(oldBase)}) found in ${onto}.
Either the parent is not merged yet (npm run git:fetch?), or the diff was edited on merge:
then name the merged PR: --base #<number>.`);
    }
    console.log(`Parent squash in ${onto}: ${git("log", "-1", "--format=%h %s", hit[1])}`);
}

const moving = git("log", "--format=  %h %s", `${oldBase}..${head}`);
const count = moving.split("\n").filter(Boolean).length;
console.log(`Plan:
  git rebase --onto ${onto} ${short(oldBase)} ${branch}
Moving ${count} commit(s) of ${branch} onto ${onto} (${short(ontoSha)}):
${moving}
Parent commits up to ${short(oldBase)} are cut off: they are already in ${onto} as a squash.`);
if (dryRun) process.exit(0);

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
const tag = `backup/${branch}/${stamp}`;
git("tag", tag, head);
console.log(`Backup: tag ${tag} → ${short(head)} (restore: git reset --hard ${tag})`);
let serverSha;
try {
    serverSha = remoteSha(branch);
    saveLease(branch, serverSha);
    console.log(`${branch} on the server: ${serverSha ? short(serverSha) : "no branch"}; saved for npm run git:push.`);
} catch (e) {
    console.log(`⚠ Could not query the server (${e.message.split("\n")[0]}); git:push will ask for the SHA itself.`);
}

const code = loud("git", ["rebase", "--onto", ontoSha, oldBase, branch]);
if (code !== 0) {
    console.log(`\nRebase stopped. Resolve the conflicts and \`git rebase --continue\`, or roll back: git rebase --abort.
Backup: ${tag}. Then: npm run git:push -- ${branch}`);
    process.exit(code);
}
console.log(`\nDone. Check (npm run check:diff), then: npm run git:push -- ${branch}`);
