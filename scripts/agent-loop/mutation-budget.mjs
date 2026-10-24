#!/usr/bin/env node
/**
 * The implementer's local mutation-testing budget: 20 minutes of runs per task (AGENT_LOOP_MUTATION_BUDGET_MIN),
 * counted only while a run is executing — never the wait for the lease slot. Always call it
 * under the lease, so the clock starts when the slot is already held:
 *
 *   claude-lease run -- node scripts/agent-loop/mutation-budget.mjs -- npm run test:mutation [-- --mutate src/x.ts]
 *
 * The ledger is <task dir>/mutation-budget.json. When the budget is spent the run is refused
 * with exit code 76 (EXIT_BUDGET_SPENT; 75 is the lease's "busy"): from then on the mutation
 * gate runs in CI only (`npm run ci:run -- mutation`). A run that starts within the budget is
 * never cut short. The wrapped command's exit code is passed through.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import {
    EXIT_BUDGET_SPENT,
    formatDuration,
    parseFlags,
    readJson,
    requireFlag,
    taskDir,
    writeJsonAtomic,
} from "./lib.mjs";

const flags = parseFlags(process.argv.slice(2));
const task = requireFlag(flags, "task");
const cmd = flags.rest;
if (cmd.length === 0) {
    console.error("usage: mutation-budget.mjs [--task <N>] -- <command...>");
    process.exit(2);
}
const budgetMin = Number(process.env.AGENT_LOOP_MUTATION_BUDGET_MIN) || 20;
const file = path.join(taskDir(task), "mutation-budget.json");
const ledger = readJson(file, { task: Number(task), budgetMin, usedSeconds: 0, runs: [] });
const remaining = budgetMin * 60 - ledger.usedSeconds;

console.log(
    `mutation budget of task ${task}: ${formatDuration(ledger.usedSeconds * 1000)} of ${budgetMin}m used, ${ledger.runs.length} run(s)`,
);
if (remaining <= 0) {
    console.error(`mutation budget spent (${budgetMin} min of local runs). Local mutation runs are over for this task:
run the gate in CI instead — npm run ci:run -- mutation (see .claude/skills/heavy-run/SKILL.md) — and fix from its report.`);
    process.exit(EXIT_BUDGET_SPENT);
}

const startedAt = new Date();
const beat = setInterval(() => {
    console.log(
        `mutation-budget: running for ${formatDuration(Date.now() - startedAt.getTime())}, ${formatDuration(remaining * 1000)} were left at start`,
    );
}, 60_000);
const res = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", env: process.env });
clearInterval(beat);
const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);

ledger.budgetMin = budgetMin;
ledger.usedSeconds += seconds;
ledger.runs.push({ startedAt: startedAt.toISOString(), seconds, cmd: cmd.join(" "), exitCode: res.status ?? null });
writeJsonAtomic(file, ledger);

const left = budgetMin * 60 - ledger.usedSeconds;
console.log(
    `mutation-budget: this run took ${formatDuration(seconds * 1000)}; ${formatDuration(ledger.usedSeconds * 1000)} of ${budgetMin}m used, ` +
        (left > 0
            ? `${formatDuration(left * 1000)} left`
            : "budget spent — further runs go to CI (npm run ci:run -- mutation)"),
);
if (res.error !== undefined) {
    console.error(`mutation-budget: could not run ${cmd[0]}: ${res.error.message}`);
    process.exit(1);
}
process.exit(res.status ?? 1);
