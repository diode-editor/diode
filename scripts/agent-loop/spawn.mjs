#!/usr/bin/env node
/**
 * Open a child session of the task in its tmux session: window `<role>` running
 * `claude --model $AGENT_LOOP_MODEL --permission-mode bypassPermissions "/<role> <N>"`.
 * The prompt is written to `<task dir>/<role>-prompt.md` (an optional note is appended) and
 * read by the window at start, so nothing goes through shell quoting. A stale status file of
 * the role is removed first. Refuses when the window already exists.
 *
 *   node scripts/agent-loop/spawn.mjs --task <N> --role implementer|tester [--note <file>]
 *
 * Every window gets a fixed claude session id (`--session-id`, kept in `sessions.json` and
 * posted to the issue by return-task.mjs). A resumed task (`resume.json`, start-task.mjs) whose
 * earlier run was on this host continues the role's old session with `claude --resume <id>`:
 * the prompt is then the same `/<role> <N>` plus what changed, and the session keeps its
 * context. Elsewhere, or without a transcript on disk, the role starts fresh with that prompt.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
    CLAUDE_GIT_ENV,
    REPO_ROOT,
    ROLES,
    loopHome,
    parseFlags,
    readJson,
    recordSession,
    requireFlag,
    resumeFile,
    sessionName,
    statusFile,
    taskDir,
    tmux,
    tmuxHasSession,
    tmuxWindows,
    transcriptOf,
} from "./lib.mjs";

const flags = parseFlags(process.argv.slice(2));
const task = requireFlag(flags, "task");
const role = requireFlag(flags, "role");
const model = process.env.AGENT_LOOP_MODEL ?? "opus";
const session = sessionName(task);

const fail = (msg) => {
    console.error(`spawn: ${msg}`);
    process.exit(1);
};
if (!ROLES.includes(role)) fail(`unknown role ${role}; one of ${ROLES.join(", ")}`);
if (!tmuxHasSession(session)) fail(`tmux session ${session} does not exist`);
if (tmuxWindows(session).some((w) => w.name === role)) fail(`window ${session}:${role} already exists`);

const resume = readJson(resumeFile(task), undefined);
const previous = resume?.sessions?.[role];
const continued = typeof previous === "string" && transcriptOf(previous) !== undefined;
const sessionId = continued ? previous : randomUUID();
recordSession(task, role, sessionId);

let prompt = `/${role} ${task}`;
if (resume !== undefined) {
    const lines = [
        `Resumed task: the loop handed it off earlier${resume.handoff ? ` (${resume.handoff.kind}: ${resume.handoff.reason})` : ""}.`,
        `Branch ${resume.branch} and PR #${resume.pr} (${resume.prUrl}) already exist — continue them, do not start over.`,
        `Tester verdict so far: ${resume.testerVerdict ?? "none"}.`,
        continued
            ? "This is your earlier session, continued: check what actually landed on the branch and in the PR before trusting your memory."
            : "No earlier context survived: read the issue, the PR, its comments and the branch first.",
        "Follow the resume section of your skill.",
    ];
    prompt += `\n\n${lines.join("\n")}`;
}
if (typeof flags.note === "string") prompt += `\n\n${readFileSync(flags.note, "utf8").trim()}\n`;
const promptFile = path.join(taskDir(task), `${role}-prompt.md`);
writeFileSync(promptFile, prompt);
rmSync(statusFile(task, role), { force: true });

const env = { ...CLAUDE_GIT_ENV, AGENT_LOOP_TASK: task, AGENT_LOOP_MODEL: model, AGENT_LOOP_HOME: loopHome() };
const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
const sessionFlag = continued ? `--resume ${sessionId}` : `--session-id ${sessionId}`;
const cmd = `claude --model ${model} --permission-mode bypassPermissions ${sessionFlag} "$(cat ${JSON.stringify(promptFile)})"`;
const res = tmux(["new-window", "-d", "-t", `=${session}`, "-n", role, "-c", REPO_ROOT, ...envFlags, cmd]);
if (!res.ok) fail(`tmux new-window failed: ${res.stderr.trim()}`);
console.log(
    `spawned ${session}:${role} (model ${model}, ${continued ? "resumed session" : "session"} ${sessionId}, prompt ${promptFile})`,
);
