#!/usr/bin/env node
/**
 * Sweep a task back to the human: one comment on the issue with the reason and the tails of
 * every window of its tmux session, the PR (if any) turned into a draft, labels
 * `in progress` → `returned`, and the session killed — last, because the manager usually
 * runs this from inside it.
 *
 *   node scripts/agent-loop/return-task.mjs --task <N> --reason "<why, for the human>" [--keep-session]
 *
 * The reason is posted verbatim: write it in the language of the issue.
 */
import {
    LABELS,
    branchName,
    gh,
    ghJson,
    parseFlags,
    paneTail,
    requireFlag,
    sessionName,
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

const parts = [`returned: ${reason}`, "", `session: ${session}${alive ? "" : " (not running)"}`];
if (pr !== undefined) parts.push(`pr: ${pr.url} (draft)`);
for (const w of tails)
    parts.push("", `<details><summary>${w.name}</summary>`, "", "```text", w.tail, "```", "", "</details>");
const comment = gh(["issue", "comment", task, "--body", parts.join("\n")]);
if (!comment.ok) console.error(`issue comment failed: ${comment.stderr.trim()}`);

if (pr !== undefined) {
    if (!pr.isDraft) {
        const draft = gh(["pr", "ready", "--undo", String(pr.number)]);
        if (!draft.ok) console.error(`pr ready --undo failed: ${draft.stderr.trim()}`);
    }
    gh(["pr", "comment", String(pr.number), "--body", `Returned to the author: see issue #${task}. ${reason}`]);
}

const relabel = gh(["issue", "edit", task, "--remove-label", LABELS.inProgress, "--add-label", LABELS.returned]);
if (!relabel.ok) console.error(`relabel failed: ${relabel.stderr.trim()}`);

console.log(
    `issue #${task} returned${pr !== undefined ? `, PR #${pr.number} is a draft` : ""}; ${tails.length} pane tail(s) attached`,
);
if (alive && flags["keep-session"] !== true) {
    console.log(`killing tmux session ${session}`);
    tmux(["kill-session", "-t", `=${session}`]);
}
