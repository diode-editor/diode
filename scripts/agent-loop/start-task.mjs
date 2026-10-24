#!/usr/bin/env node
/**
 * Take one issue into the loop: claim it (a `claim: <host> <time>` comment; an earlier claim by
 * another host wins), swap `ready to implement` → `in progress`, reset the task directory and
 * start the tmux session `task-<N>` with the manager in window `manager`.
 *
 *   node scripts/agent-loop/start-task.mjs --issue <N>
 *
 * Exit codes: 0 started; 3 refused (branch `issue/<N>` already on origin → labelled returned,
 * or the issue is not eligible); 4 lost the claim to another host; 1 error.
 */
import { rmSync } from "node:fs";
import path from "node:path";

import {
    HTTPS_ORIGIN,
    LABELS,
    REPO_ROOT,
    ROLES,
    branchName,
    gh,
    ghJson,
    git,
    host,
    loopHome,
    nowIso,
    parseFlags,
    requireFlag,
    sessionName,
    taskDir,
    tmux,
    tmuxHasSession,
} from "./lib.mjs";

const flags = parseFlags(process.argv.slice(2));
const issue = requireFlag(flags, "issue");
const model = process.env.AGENT_LOOP_MODEL ?? "opus";
const session = sessionName(issue);
const branch = branchName(issue);

const fail = (msg, code = 1) => {
    console.error(`start-task: ${msg}`);
    process.exit(code);
};

const view = ghJson(["issue", "view", issue, "--json", "number,state,labels,title"]);
const labels = view.labels.map((l) => l.name);
if (view.state !== "OPEN") fail(`issue #${issue} is ${view.state}`, 3);
if (!labels.includes(LABELS.ready)) fail(`issue #${issue} has no "${LABELS.ready}" label`, 3);
if (labels.includes(LABELS.inProgress) || labels.includes(LABELS.returned))
    fail(`issue #${issue} is in progress or returned`, 3);
if (tmuxHasSession(session)) fail(`tmux session ${session} already exists`, 3);

const remote = git(["ls-remote", "--heads", HTTPS_ORIGIN, branch], { timeout: 60_000 }).stdout.trim();
if (remote !== "") {
    gh([
        "issue",
        "comment",
        issue,
        "--body",
        `returned: ${host()} ${nowIso()}\n\nBranch \`${branch}\` already exists on origin. The loop starts a task only from scratch: delete or rename the branch (and close its PR), then put \`${LABELS.ready}\` back.`,
    ]);
    gh(["issue", "edit", issue, "--remove-label", LABELS.ready, "--add-label", LABELS.returned]);
    fail(`branch ${branch} exists on origin; issue labelled "${LABELS.returned}"`, 3);
}

const claimAt = nowIso();
const claimed = gh(["issue", "comment", issue, "--body", `claim: ${host()} ${claimAt}\nsession: ${session}`]);
if (!claimed.ok) fail(`claim comment failed: ${claimed.stderr.trim()}`);
await new Promise((r) => setTimeout(r, 5000));
const comments = ghJson(["issue", "view", issue, "--json", "comments", "--jq", ".comments"]) ?? [];
const claims = comments
    .map((c) => /^claim:\s*(\S+)\s+(\S+)/m.exec(c.body ?? ""))
    .filter((m) => m !== null)
    .map((m) => ({ host: m[1], at: m[2] }))
    .sort((a, b) => a.at.localeCompare(b.at));
if (claims.length > 0 && claims[0].host !== host()) {
    fail(`issue #${issue} was claimed earlier by ${claims[0].host} at ${claims[0].at}`, 4);
}

const relabel = gh(["issue", "edit", issue, "--remove-label", LABELS.ready, "--add-label", LABELS.inProgress]);
if (!relabel.ok) fail(`relabel failed: ${relabel.stderr.trim()}`);

const dir = taskDir(issue);
for (const name of [
    ...ROLES.map((r) => `${r}.json`),
    ...ROLES.map((r) => `${r}-prompt.md`),
    "mutation-budget.json",
    "test-plan.md",
]) {
    rmSync(path.join(dir, name), { force: true });
}

const claudeCmd = `claude --model ${model} --permission-mode bypassPermissions "/task-manager ${issue}"`;
const env = { AGENT_LOOP_TASK: issue, AGENT_LOOP_MODEL: model, AGENT_LOOP_HOME: loopHome() };
const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
const created = tmux(["new-session", "-d", "-s", session, "-n", "manager", "-c", REPO_ROOT, ...envFlags, claudeCmd]);
if (!created.ok) {
    gh(["issue", "edit", issue, "--remove-label", LABELS.inProgress, "--add-label", LABELS.ready]);
    fail(`tmux new-session failed: ${created.stderr.trim()}`);
}
// Windows the manager opens later inherit the session environment.
for (const [k, v] of Object.entries(env)) tmux(["set-environment", "-t", `=${session}`, k, v]);

console.log(`started ${session}: issue #${issue} "${view.title}", branch ${branch}, model ${model}, task dir ${dir}`);
