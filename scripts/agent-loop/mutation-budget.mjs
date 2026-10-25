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
 * gate runs in CI only (`npm run ci:run -- mutation`). The budget is a hard ceiling for a
 * running run too: the command runs in its own process group and is killed the moment the
 * remaining budget is used up, again with exit code 76 — a single run once held the machine's
 * only lease slot for two hours. So that the run usually ends on its own, with a report, the
 * re-verification phase gets a deadline one minute earlier through MUTATION_DEADLINE_MS
 * (mutation-diff.mjs: mutants left over are inconclusive). The wrapped command's exit code is
 * passed through otherwise.
 */
import { spawn } from "node:child_process";
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
const stopAt = startedAt.getTime() + remaining * 1000;
// Re-verification stops by itself a minute before the hard stop, so the report still gets written.
const verifyDeadline = Math.max(startedAt.getTime(), stopAt - 60_000);
console.log(
    `mutation-budget: ${formatDuration(remaining * 1000)} left; the run is stopped at ${new Date(stopAt).toISOString()}`,
);

const child = spawn(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    detached: true,
    env: { ...process.env, MUTATION_DEADLINE_MS: String(verifyDeadline) },
});
let cut = false;
const killGroup = (signal) => {
    if (child.pid === undefined) return;
    try {
        process.kill(-child.pid, signal);
    } catch {
        /* already gone */
    }
};
const beat = setInterval(() => {
    console.log(
        `mutation-budget: running for ${formatDuration(Date.now() - startedAt.getTime())}, ${formatDuration(Math.max(0, stopAt - Date.now()))} left`,
    );
}, 60_000);
const ceiling = setTimeout(() => {
    cut = true;
    console.error(
        `\nmutation-budget: the ${budgetMin}-minute budget of task ${task} is used up mid-run — stopping it.`,
    );
    killGroup("SIGTERM");
    setTimeout(() => killGroup("SIGKILL"), 10_000).unref();
}, remaining * 1000);
// The lease (or a Ctrl-C) terminates us: take the run down with us, do not leave an orphan in the slot.
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(signal, () => {
        killGroup(signal);
        setTimeout(() => killGroup("SIGKILL"), 10_000).unref();
    });
}

child.on("error", (error) => {
    clearInterval(beat);
    clearTimeout(ceiling);
    console.error(`mutation-budget: could not run ${cmd[0]}: ${error.message}`);
    process.exit(1);
});
child.on("exit", (code, signal) => {
    clearInterval(beat);
    clearTimeout(ceiling);
    const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
    ledger.budgetMin = budgetMin;
    ledger.usedSeconds += seconds;
    ledger.runs.push({
        startedAt: startedAt.toISOString(),
        seconds,
        cmd: cmd.join(" "),
        exitCode: code,
        ...(cut ? { cut: true } : {}),
    });
    writeJsonAtomic(file, ledger);

    const left = budgetMin * 60 - ledger.usedSeconds;
    console.log(
        `mutation-budget: this run took ${formatDuration(seconds * 1000)}; ${formatDuration(ledger.usedSeconds * 1000)} of ${budgetMin}m used, ` +
            (left > 0
                ? `${formatDuration(left * 1000)} left`
                : "budget spent — further runs go to CI (npm run ci:run -- mutation)"),
    );
    if (cut) {
        console.error(`mutation-budget: the run was stopped by the budget; its result is not a verdict. Local mutation runs are over for this task:
run the gate in CI instead — npm run ci:run -- mutation (see .claude/skills/heavy-run/SKILL.md) — and fix from its report.`);
        process.exit(EXIT_BUDGET_SPENT);
    }
    process.exit(code ?? (signal !== null ? 1 : 1));
});
