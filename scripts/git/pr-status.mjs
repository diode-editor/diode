#!/usr/bin/env node
// npm run git:pr-status [-- <PR | branch>] [--watch] [--interval 60s]: PR mergeability and checks at a glance.
//
// What it knows beyond `gh pr view` / `gh pr checks --watch`:
//   - mergeable=UNKNOWN means GitHub is still computing; it asks again after a pause
//     instead of answering "unknown";
//   - CONFLICTING with no checks at all means CI WILL NOT START until the PR becomes
//     mergeable (the pull_request event creates no merge commit for a conflicting PR).
//     "No checks" here means "merge main", not "wait".
//
// --watch blocks until the checks of the current head are all complete, and leaves at once when
// the PR turns CONFLICTING: checks of a conflicting PR are worthless (the base they ran against is
// gone), waiting for them is what kept a loop task hanging for hours. Exit codes:
//   0  all checks green (or the PR is merged)
//   1  a check failed, or the PR is closed
//   13 the PR conflicts with its base — merge the base in, push, watch again
import { cap, die, sleep } from "./lib.mjs";

const EXIT_CONFLICTING = 13;

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith("-"));
const watch = argv.includes("--watch");
const intervalArg = argv[argv.indexOf("--interval") + 1];
const intervalMs = argv.includes("--interval") ? parseDuration(intervalArg) : 60_000;
const FIELDS = "number,title,url,state,isDraft,headRefName,baseRefName,mergeable,mergeStateStatus,statusCheckRollup";
/** How long to wait for GitHub to compute mergeability in the one-shot mode. */
const UNKNOWN_RETRIES = 5;

function parseDuration(text) {
    const m = /^(\d+(?:\.\d+)?)\s*(h|m|s)?$/.exec(String(text ?? "").trim());
    if (m === null) die(`bad --interval: ${text}`);
    return Math.round(Number(m[1]) * { h: 3_600_000, m: 60_000, s: 1000 }[m[2] ?? "s"]);
}

function view() {
    const r = cap("gh", ["pr", "view", ...(target ? [target] : []), "--json", FIELDS], { allowFail: true });
    if (!r.ok) die(`gh pr view: ${r.err || r.out}`);
    return JSON.parse(r.out);
}

const verdict = (c) =>
    c.__typename === "StatusContext" ? c.state : c.status === "COMPLETED" ? c.conclusion : c.status;
const BAD = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const DONE = new Set(["SUCCESS", "NEUTRAL", "SKIPPED", ...BAD]);

function summarize(pr) {
    const checks = pr.statusCheckRollup ?? [];
    const groups = new Map();
    for (const c of checks) {
        const v = verdict(c) ?? "UNKNOWN";
        groups.set(v, [...(groups.get(v) ?? []), c]);
    }
    return {
        checks,
        line: checks.length === 0 ? "none" : [...groups].map(([v, cs]) => `${v} ${cs.length}`).join(", "),
        failed: checks.filter((c) => BAD.has(verdict(c))),
        pending: checks.filter((c) => !DONE.has(verdict(c))),
    };
}

function conflictAdvice(pr, checks) {
    return `
⚠ The PR conflicts with ${pr.baseRefName}.${checks.length === 0 ? " CI will not start on it at all until the PR becomes mergeable:" : " Fresh CI will not start until the conflict is resolved:"}
  npm run git:fetch && git merge origin/${pr.baseRefName}   (PRs are squash-merged: a merge commit is fine and needs no force push)
  or rebase: git rebase origin/${pr.baseRefName} && npm run git:push   (stack after a squash: npm run git:stack-rebase)`;
}

function report(pr) {
    const s = summarize(pr);
    console.log(`#${pr.number} ${pr.title}
${pr.url}
${pr.state}${pr.isDraft ? " (draft)" : ""}: ${pr.headRefName} → ${pr.baseRefName}
mergeable: ${pr.mergeable}, mergeStateStatus: ${pr.mergeStateStatus}
checks: ${s.line}`);
    for (const c of s.failed)
        console.log(`  ✗ ${c.name ?? c.context}: ${verdict(c)} ${c.detailsUrl ?? c.targetUrl ?? ""}`);
    if (pr.state === "OPEN" && pr.mergeable === "CONFLICTING") console.log(conflictAdvice(pr, s.checks));
    else if (pr.state === "OPEN" && pr.mergeable === "UNKNOWN")
        console.log("\nmergeable is still UNKNOWN: ask again in a minute.");
    return s;
}

if (!watch) {
    let pr = view();
    for (let i = 0; pr.state === "OPEN" && pr.mergeable === "UNKNOWN" && i < UNKNOWN_RETRIES; i++) {
        console.log("GitHub is still computing mergeability, waiting 3 s…");
        sleep(3000);
        pr = view();
    }
    report(pr);
} else {
    const started = Date.now();
    for (let tick = 0; ; tick++) {
        const pr = view();
        const s = summarize(pr);
        if (pr.state !== "OPEN") {
            report(pr);
            process.exit(pr.state === "MERGED" ? 0 : 1);
        }
        if (pr.mergeable === "CONFLICTING") {
            report(pr);
            console.log("\nNot waiting for the checks: they would run against a base that is gone.");
            process.exit(EXIT_CONFLICTING);
        }
        if (s.checks.length > 0 && s.pending.length === 0) {
            report(pr);
            process.exit(s.failed.length === 0 ? 0 : 1);
        }
        const elapsed = Math.round((Date.now() - started) / 60_000);
        const what =
            s.checks.length === 0
                ? "no checks reported yet"
                : `${s.pending.length} of ${s.checks.length} checks pending`;
        console.log(
            `[${elapsed}m] #${pr.number} ${pr.headRefName}: mergeable ${pr.mergeable}, ${what}${tick === 0 ? ` (polling every ${Math.round(intervalMs / 1000)} s)` : ""}`,
        );
        sleep(intervalMs);
    }
}
