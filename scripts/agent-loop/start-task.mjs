#!/usr/bin/env node
/**
 * Take one issue into the loop: claim it (a `claim: <host> <time>` comment; an earlier claim by
 * another host wins), swap `ready to implement` → `in progress`, reset the task directory and
 * start the tmux session `task-<N>` with the manager in window `manager`.
 *
 *   node scripts/agent-loop/start-task.mjs --issue <N>
 *
 * A branch `issue/<N>` with an open PR on origin means the task was in the loop before (a
 * requeue after a timeout, or the human put `ready to implement` back on a returned task): the
 * task is RESUMED, not restarted. `resume.json` in the task directory tells the manager and
 * spawn.mjs what is already there: the PR, the hand-off reason, the tester's verdict restored
 * from its `verdict:` PR comment (then `tester.json` is written too, so the implementer does not
 * wait for a second verdict) and, on the host that ran the task before, the claude session ids
 * to continue with `claude --resume`. A branch without an open PR is not resumable: the issue
 * is labelled `returned` for the human to delete or rename the branch.
 *
 * Exit codes: 0 started; 3 refused (branch without a PR → labelled returned, or the issue is
 * not eligible); 4 lost the claim to another host; 1 error.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";

import {
    CLAUDE_GIT_ENV,
    HTTPS_ORIGIN,
    LABELS,
    REPO_ROOT,
    ROLES,
    branchName,
    claimsAfterHandoff,
    gh,
    ghJson,
    git,
    host,
    issueComments,
    latestHandoff,
    loopHome,
    nowIso,
    parseFlags,
    recordSession,
    requeueCount,
    requireFlag,
    resumeFile,
    sessionName,
    sessionsFromComments,
    statusFile,
    taskDir,
    tmux,
    tmuxHasSession,
    transcriptOf,
    writeJsonAtomic,
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
let resume;
if (remote !== "") {
    const pr = ghJson(["pr", "list", "--state", "open", "--head", branch, "--json", "number,url,isDraft"])[0];
    if (pr === undefined) {
        gh([
            "issue",
            "comment",
            issue,
            "--body",
            `returned: ${host()} ${nowIso()}\n\nBranch \`${branch}\` exists on origin but has no open PR, so there is nothing to resume: delete or rename the branch, then put \`${LABELS.ready}\` back.`,
        ]);
        gh(["issue", "edit", issue, "--remove-label", LABELS.ready, "--add-label", LABELS.returned]);
        fail(`branch ${branch} exists on origin without an open PR; issue labelled "${LABELS.returned}"`, 3);
    }
    const comments = issueComments(issue);
    const handoff = latestHandoff(comments);
    const sessions = sessionsFromComments(comments);
    const sameHost = sessions !== undefined && sessions.host === host();
    const prComments = ghJson(["pr", "view", String(pr.number), "--json", "comments", "--jq", ".comments"]) ?? [];
    let verdict;
    for (const c of prComments) {
        const m = /^verdict:\s*(approve|bugs)\b/m.exec(c.body ?? "");
        if (m !== null) verdict = m[1];
    }
    resume = {
        task: Number(issue),
        at: nowIso(),
        pr: pr.number,
        prUrl: pr.url,
        prDraft: pr.isDraft,
        branch,
        handoff: handoff === undefined ? undefined : { kind: handoff.kind, reason: handoff.reason },
        requeues: requeueCount(comments),
        previousHost: sessions?.host,
        sameHost,
        // Only sessions whose transcript is on this disk can be resumed.
        sessions: sameHost
            ? Object.fromEntries(Object.entries(sessions.ids).filter(([, id]) => transcriptOf(id) !== undefined))
            : {},
        testerVerdict: verdict,
    };
}

const claimAt = nowIso();
const claimed = gh(["issue", "comment", issue, "--body", `claim: ${host()} ${claimAt}\nsession: ${session}`]);
if (!claimed.ok) fail(`claim comment failed: ${claimed.stderr.trim()}`);
await new Promise((r) => setTimeout(r, 5000));
const claims = claimsAfterHandoff(issueComments(issue));
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
    "sessions.json",
    "resume.json",
]) {
    rmSync(path.join(dir, name), { force: true });
}
if (resume !== undefined) {
    writeJsonAtomic(resumeFile(issue), resume);
    if (resume.testerVerdict !== undefined) {
        writeJsonAtomic(statusFile(issue, "tester"), {
            role: "tester",
            task: Number(issue),
            status: resume.testerVerdict,
            at: nowIso(),
            branch: `${branch}/tests`,
            resumed: true,
            note: `verdict restored from the tester's PR comment on resume; the report (and the failing tests, if any) are in PR #${resume.pr} and on the branch ${branch}/tests`,
        });
    }
    if (resume.prDraft) {
        const ready = gh(["pr", "ready", String(resume.pr)]);
        if (!ready.ok) console.error(`pr ready failed: ${ready.stderr.trim()}`);
    }
}

const managerSession = randomUUID();
recordSession(issue, "manager", managerSession);
const claudeCmd = `claude --model ${model} --permission-mode bypassPermissions --session-id ${managerSession} "/task-manager ${issue}"`;
const env = { ...CLAUDE_GIT_ENV, AGENT_LOOP_TASK: issue, AGENT_LOOP_MODEL: model, AGENT_LOOP_HOME: loopHome() };
const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
const created = tmux(["new-session", "-d", "-s", session, "-n", "manager", "-c", REPO_ROOT, ...envFlags, claudeCmd]);
if (!created.ok) {
    gh(["issue", "edit", issue, "--remove-label", LABELS.inProgress, "--add-label", LABELS.ready]);
    fail(`tmux new-session failed: ${created.stderr.trim()}`);
}
// Windows the manager opens later inherit the session environment.
for (const [k, v] of Object.entries(env)) tmux(["set-environment", "-t", `=${session}`, k, v]);

const how =
    resume === undefined
        ? "from scratch"
        : `resumed: PR #${resume.pr}, tester verdict ${resume.testerVerdict ?? "none"}, sessions to continue: ${Object.keys(resume.sessions).join(", ") || "none"}${resume.previousHost !== undefined && !resume.sameHost ? ` (ran on ${resume.previousHost} before)` : ""}`;
console.log(
    `started ${session}: issue #${issue} "${view.title}", branch ${branch}, model ${model}, task dir ${dir}, ${how}`,
);
