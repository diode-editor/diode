#!/usr/bin/env node
// npm run git:pr-status [-- <PR | branch>]: PR mergeability and checks at a glance.
//
// What it knows beyond `gh pr view`:
//   - mergeable=UNKNOWN means GitHub is still computing; it asks again after a pause
//     instead of answering "unknown";
//   - CONFLICTING with no checks at all means CI WILL NOT START until the PR becomes
//     mergeable (the pull_request event creates no merge commit for a conflicting PR).
//     "No checks" here means "rebase", not "wait".
import { cap, die, sleep } from "./lib.mjs";

const target = process.argv.slice(2).find((a) => !a.startsWith("-"));
const FIELDS = "number,title,url,state,isDraft,headRefName,baseRefName,mergeable,mergeStateStatus,statusCheckRollup";

function view() {
    const r = cap("gh", ["pr", "view", ...(target ? [target] : []), "--json", FIELDS], { allowFail: true });
    if (!r.ok) die(`gh pr view: ${r.err || r.out}`);
    return JSON.parse(r.out);
}

let pr = view();
for (let i = 0; pr.state === "OPEN" && pr.mergeable === "UNKNOWN" && i < 5; i++) {
    console.log("GitHub is still computing mergeability, waiting 3 s…");
    sleep(3000);
    pr = view();
}

const checks = pr.statusCheckRollup ?? [];
const verdict = (c) =>
    c.__typename === "StatusContext" ? c.state : c.status === "COMPLETED" ? c.conclusion : c.status;
const groups = new Map();
for (const c of checks) {
    const v = verdict(c) ?? "UNKNOWN";
    groups.set(v, [...(groups.get(v) ?? []), c]);
}

console.log(`#${pr.number} ${pr.title}
${pr.url}
${pr.state}${pr.isDraft ? " (draft)" : ""}: ${pr.headRefName} → ${pr.baseRefName}
mergeable: ${pr.mergeable}, mergeStateStatus: ${pr.mergeStateStatus}
checks: ${checks.length === 0 ? "none" : [...groups].map(([v, cs]) => `${v} ${cs.length}`).join(", ")}`);

const BAD = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
for (const c of checks) {
    if (BAD.has(verdict(c)))
        console.log(`  ✗ ${c.name ?? c.context}: ${verdict(c)} ${c.detailsUrl ?? c.targetUrl ?? ""}`);
}

if (pr.state === "OPEN" && pr.mergeable === "CONFLICTING") {
    console.log(`
⚠ The PR conflicts with ${pr.baseRefName}.${checks.length === 0 ? " CI will not start on it at all until the PR becomes mergeable:" : " Fresh CI will not start until the conflict is resolved:"}
  npm run git:fetch && git rebase origin/${pr.baseRefName}   (stack after a squash: npm run git:stack-rebase)
  npm run git:push`);
} else if (pr.state === "OPEN" && pr.mergeable === "UNKNOWN") {
    console.log("\nmergeable is still UNKNOWN: ask again in a minute.");
}
