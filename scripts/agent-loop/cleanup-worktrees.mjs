#!/usr/bin/env node
/**
 * Remove worktrees whose PR is merged and nobody works in (no process has its cwd there),
 * whoever created them. Also prunes stale worktree records, deletes local `issue/*` branches of
 * merged PRs and the tester branches `issue/<N>/tests` of merged tasks on origin.
 * Unmerged or busy worktrees are left alone; uncommitted changes in a merged one are not saved.
 * "Merged" is the PR state (PRs are squash-merged, so git ancestry cannot tell).
 *
 *   node scripts/agent-loop/cleanup-worktrees.mjs [--dry-run]
 */
import { HTTPS_ORIGIN, git, mergedHeads, parseFlags, worktrees } from "./lib.mjs";

const flags = parseFlags(process.argv.slice(2));
const dry = flags["dry-run"] === true;
const act = (label, fn) => {
    console.log(`${dry ? "would " : ""}${label}`);
    if (!dry) fn();
};

const merged = mergedHeads();
if (merged === undefined) {
    console.log("gh pr list failed: cannot tell merged branches, nothing removed");
    process.exit(0);
}

const removedBranches = new Set();
for (const w of worktrees(merged)) {
    if (!w.exists) {
        act(`prune vanished worktree record ${w.path}`, () => git(["worktree", "prune"]));
        continue;
    }
    if (!w.merged) {
        console.log(`keep ${w.path} (${w.branch ?? "detached"}: no merged PR)`);
        continue;
    }
    if (w.busy > 0) {
        console.log(`keep ${w.path} (${w.branch}: merged, but ${w.busy} process(es) have their cwd there)`);
        continue;
    }
    act(`remove ${w.path} (${w.branch}: merged${w.dirty ? ", uncommitted changes dropped" : ""})`, () => {
        const res = git(["worktree", "remove", "--force", w.path], { timeout: 120_000 });
        if (!res.ok) console.log(`  failed: ${res.stderr.trim()}`);
    });
    if (w.branch !== undefined) removedBranches.add(w.branch);
}
act("git worktree prune", () => git(["worktree", "prune"]));

// Only the loop's own branches and those of the worktrees just removed: other local branches are the human's.
const localBranches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
    .stdout.trim()
    .split("\n")
    .filter((b) => b !== "" && b !== "main" && merged.has(b) && (b.startsWith("issue/") || removedBranches.has(b)));
const checkedOut = git(["worktree", "list", "--porcelain"]).stdout;
for (const b of localBranches) {
    if (checkedOut.includes(`branch refs/heads/${b}\n`)) continue;
    act(`delete local branch ${b} (PR merged)`, () => git(["branch", "-D", b]));
}

const remote = git(["ls-remote", "--heads", "origin", "issue/*/tests"], { timeout: 60_000 }).stdout;
for (const line of remote.trim().split("\n").filter(Boolean)) {
    const tests = line.split(/\s+/)[1].replace("refs/heads/", "");
    const task = tests.replace(/\/tests$/, "");
    if (!merged.has(task)) continue;
    act(`delete remote ${tests} (PR of ${task} merged)`, () => {
        const res = git(["push", HTTPS_ORIGIN, "--delete", tests], { timeout: 120_000 });
        if (!res.ok) console.log(`  failed: ${res.stderr.trim()}`);
    });
}
