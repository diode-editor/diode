#!/usr/bin/env node
/**
 * Open a child session of the task in its tmux session: window `<role>` running
 * `claude --model $AGENT_LOOP_MODEL --permission-mode bypassPermissions "/<role> <N>"`.
 * The prompt is written to `<task dir>/<role>-prompt.md` (an optional note is appended) and
 * read by the window at start, so nothing goes through shell quoting. A stale status file of
 * the role is removed first. Refuses when the window already exists.
 *
 *   node scripts/agent-loop/spawn.mjs --task <N> --role implementer|tester [--note <file>]
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
    CLAUDE_GIT_ENV,
    REPO_ROOT,
    ROLES,
    loopHome,
    parseFlags,
    requireFlag,
    sessionName,
    statusFile,
    taskDir,
    tmux,
    tmuxHasSession,
    tmuxWindows,
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

let prompt = `/${role} ${task}`;
if (typeof flags.note === "string") prompt += `\n\n${readFileSync(flags.note, "utf8").trim()}\n`;
const promptFile = path.join(taskDir(task), `${role}-prompt.md`);
writeFileSync(promptFile, prompt);
rmSync(statusFile(task, role), { force: true });

const env = { ...CLAUDE_GIT_ENV, AGENT_LOOP_TASK: task, AGENT_LOOP_MODEL: model, AGENT_LOOP_HOME: loopHome() };
const envFlags = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
const cmd = `claude --model ${model} --permission-mode bypassPermissions "$(cat ${JSON.stringify(promptFile)})"`;
const res = tmux(["new-window", "-d", "-t", `=${session}`, "-n", role, "-c", REPO_ROOT, ...envFlags, cmd]);
if (!res.ok) fail(`tmux new-window failed: ${res.stderr.trim()}`);
console.log(`spawned ${session}:${role} (model ${model}, prompt ${promptFile})`);
