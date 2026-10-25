#!/usr/bin/env node
/**
 * Put `in progress` back on a task whose tmux session is alive on this host but whose issue
 * says `ready to implement`: a dispatcher elsewhere swept it by mistake, or the human moved the
 * label while the task was running. Without this the queue would offer the task a second time
 * and a foreign host could start it in parallel.
 *
 *   node scripts/agent-loop/reclaim-task.mjs --issue <N> [--dry-run]
 *
 * Posts a fresh `claim: <host> <ISO>` (dated by the session's start, so the task's owner and age
 * are right again after whatever hand-off comment preceded it) and swaps the labels.
 *
 * Exit codes: 0 reclaimed; 3 nothing to reclaim (no session here, or the label is not
 * `ready to implement`); 1 error.
 */
import { LABELS, gh, ghJson, host, nowIso, parseFlags, requireFlag, sessionName, tmuxSessions } from "./lib.mjs";

const flags = parseFlags(process.argv.slice(2));
const issue = requireFlag(flags, "issue");
const session = sessionName(issue);

const fail = (msg, code = 1) => {
    console.error(`reclaim-task: ${msg}`);
    process.exit(code);
};

const live = tmuxSessions().find((s) => s.name === session);
if (live === undefined) fail(`tmux session ${session} is not running on ${host()}`, 3);

const view = ghJson(["issue", "view", issue, "--json", "state,labels"]);
const labels = view.labels.map((l) => l.name);
if (view.state !== "OPEN") fail(`issue #${issue} is ${view.state}`, 3);
if (labels.includes(LABELS.inProgress)) fail(`issue #${issue} is already "${LABELS.inProgress}"`, 3);
if (!labels.includes(LABELS.ready)) fail(`issue #${issue} has no "${LABELS.ready}" label`, 3);

const body = [
    `claim: ${host()} ${live.createdAt}`,
    `session: ${session}`,
    "",
    `Reclaimed ${nowIso()}: the session has been alive on ${host()} since ${live.createdAt}, but the issue said \`${LABELS.ready}\`. Label put back to \`${LABELS.inProgress}\`; the task goes on.`,
].join("\n");

if (flags["dry-run"] === true) {
    console.log(`would comment on #${issue}:\n${body}\nwould relabel "${LABELS.ready}" → "${LABELS.inProgress}"`);
    process.exit(0);
}
const comment = gh(["issue", "comment", issue, "--body", body]);
if (!comment.ok) fail(`claim comment failed: ${comment.stderr.trim()}`);
const relabel = gh(["issue", "edit", issue, "--remove-label", LABELS.ready, "--add-label", LABELS.inProgress]);
if (!relabel.ok) fail(`relabel failed: ${relabel.stderr.trim()}`);
console.log(
    `issue #${issue} reclaimed by ${host()}: session ${session} alive since ${live.createdAt}, label "${LABELS.inProgress}"`,
);
