#!/usr/bin/env node
/**
 * Sweep a task out of its session: one comment on the issue with the reason, the session ids
 * to resume and the tails of every window of its tmux session, then the session killed —
 * last, because the manager usually runs this from inside it. Two destinations:
 *
 *   node scripts/agent-loop/return-task.mjs --task <N> --reason "<why>" [--keep-session]
 *       to the human: the PR becomes a draft, labels `in progress` → `returned`;
 *   node scripts/agent-loop/return-task.mjs --task <N> --reason "<why>" --requeue
 *       back into the queue: labels `in progress` → `ready to implement`, the PR stays as it is,
 *       and the next tick resumes the task (start-task.mjs). After AGENT_LOOP_MAX_RESUMES
 *       requeues (default 2) the task goes to the human instead, whatever the flag says.
 *
 * The reason is posted verbatim: write it in the language of the issue.
 */
import {
    LABELS,
    MAX_RESUMES,
    branchName,
    gh,
    ghJson,
    issueComments,
    parseFlags,
    paneTail,
    requeueCount,
    requireFlag,
    sessionName,
    sessionsLine,
    tmux,
    tmuxHasSession,
    tmuxWindows,
} from "./lib.mjs";

const flags = parseFlags(process.argv.slice(2));
const task = requireFlag(flags, "task");
const reason = requireFlag(flags, "reason");
const session = sessionName(task);
const alive = tmuxHasSession(session);

const tails = alive
    ? tmuxWindows(session)
          .map((w) => ({ name: w.name, tail: paneTail(`=${session}:${w.name}`, 40) }))
          .filter((w) => w.tail !== undefined && w.tail !== "")
    : [];

let pr;
try {
    pr = ghJson(["pr", "list", "--state", "open", "--head", branchName(task), "--json", "number,url,isDraft"])[0];
} catch (error) {
    console.error(`pr lookup failed: ${error.message}`);
}

let requeues = 0;
try {
    requeues = requeueCount(issueComments(task));
} catch (error) {
    console.error(`comment lookup failed: ${error.message}`);
}
// Nothing to resume without a PR: a requeue would only come straight back.
const requeue = flags.requeue === true && pr !== undefined && requeues < MAX_RESUMES;
const exhausted = flags.requeue === true && !requeue;

const parts = [`${requeue ? "requeued" : "returned"}: ${reason}`];
if (requeue) parts.push(`resume: ${requeues + 1}/${MAX_RESUMES}`);
else if (exhausted)
    parts.push(
        pr === undefined
            ? "Not requeued: no open PR to resume."
            : `Not requeued: resumed ${requeues} time(s) already (AGENT_LOOP_MAX_RESUMES ${MAX_RESUMES}).`,
    );
parts.push("", `session: ${session}${alive ? "" : " (not running)"}`);
const sessions = sessionsLine(task);
if (sessions !== undefined) parts.push(sessions);
if (pr !== undefined) parts.push(`pr: ${pr.url}${requeue ? "" : " (draft)"}`);
for (const w of tails)
    parts.push("", `<details><summary>${w.name}</summary>`, "", "```text", w.tail, "```", "", "</details>");
const comment = gh(["issue", "comment", task, "--body", parts.join("\n")]);
if (!comment.ok) console.error(`issue comment failed: ${comment.stderr.trim()}`);

if (pr !== undefined) {
    if (!requeue && !pr.isDraft) {
        const draft = gh(["pr", "ready", "--undo", String(pr.number)]);
        if (!draft.ok) console.error(`pr ready --undo failed: ${draft.stderr.trim()}`);
    }
    gh([
        "pr",
        "comment",
        String(pr.number),
        "--body",
        requeue
            ? `Back in the loop's queue, to be resumed: see issue #${task}. ${reason}`
            : `Returned to the author: see issue #${task}. ${reason}`,
    ]);
}

const relabel = gh([
    "issue",
    "edit",
    task,
    "--remove-label",
    LABELS.inProgress,
    "--add-label",
    requeue ? LABELS.ready : LABELS.returned,
]);
if (!relabel.ok) console.error(`relabel failed: ${relabel.stderr.trim()}`);

console.log(
    `issue #${task} ${requeue ? `requeued (resume ${requeues + 1}/${MAX_RESUMES})` : "returned"}${
        pr !== undefined ? `, PR #${pr.number}${requeue ? "" : " is a draft"}` : ""
    }; ${tails.length} pane tail(s) attached`,
);
if (alive && flags["keep-session"] !== true) {
    console.log(`killing tmux session ${session}`);
    tmux(["kill-session", "-t", `=${session}`]);
}
