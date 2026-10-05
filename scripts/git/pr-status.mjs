#!/usr/bin/env node
// npm run git:pr-status [-- <PR | ветка>] — мерджабельность и проверки PR одним взглядом.
//
// Что он знает сверх `gh pr view`:
//   - mergeable=UNKNOWN — GitHub ещё считает; переспрашивает с паузой, а не
//     отвечает «неизвестно»;
//   - CONFLICTING и нет ни одной проверки — CI НЕ ЗАПУСТИТСЯ, пока PR не станет
//     мерджабельным (pull_request-событие для конфликтного PR не создаёт
//     merge-коммит). «Нет проверок» тут значит «ребейзни», а не «подожди».
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
    console.log("GitHub ещё считает мерджабельность — жду 3 с…");
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
проверки: ${checks.length === 0 ? "нет" : [...groups].map(([v, cs]) => `${v} ${cs.length}`).join(", ")}`);

const BAD = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
for (const c of checks) {
    if (BAD.has(verdict(c)))
        console.log(`  ✗ ${c.name ?? c.context}: ${verdict(c)} ${c.detailsUrl ?? c.targetUrl ?? ""}`);
}

if (pr.state === "OPEN" && pr.mergeable === "CONFLICTING") {
    console.log(`
⚠ PR конфликтует с ${pr.baseRefName}.${checks.length === 0 ? " CI на нём не запустится вовсе, пока PR не станет мерджабельным:" : " Свежий CI не запустится, пока конфликт не снят:"}
  npm run git:fetch && git rebase origin/${pr.baseRefName}   (стек после squash — npm run git:stack-rebase)
  npm run git:push`);
} else if (pr.state === "OPEN" && pr.mergeable === "UNKNOWN") {
    console.log("\nmergeable так и остался UNKNOWN — спроси ещё раз через минуту.");
}
