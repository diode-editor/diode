#!/usr/bin/env node
/**
 * Block until the first event of a role in a task, print it and exit. Events and exit codes:
 *   status      0   the role wrote its status file (printed as JSON)
 *   window-gone 10  the role's tmux window (or the whole session) disappeared without a status
 *   idle        11  the pane did not change for --idle AND claude runs no command (no Bash
 *                   child): a session that hangs or waits for a human
 *   timeout     12  --timeout elapsed
 *
 *   node scripts/agent-loop/wait.mjs --task <N> --role implementer|tester
 *       [--timeout 4h] [--idle 15m] [--interval 30s] [--expect <status>]
 *
 * `--expect done` ignores a status file that still holds an earlier status (ready-for-test);
 * a `returned` status always counts.
 * A window not seen yet gets {@link SPAWN_GRACE_MS} to appear: the implementer starts waiting for the
 * tester right after `ready-for-test`, and the manager spawns the tester only once it sees that status.
 * A heartbeat line is printed once a minute so the caller's own pane keeps changing.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import {
    formatDuration,
    paneIsRunning,
    paneTail,
    paneText,
    parseDuration,
    parseFlags,
    requireFlag,
    sessionName,
    statusFile,
    tmuxHasSession,
    tmuxWindows,
} from "./lib.mjs";

const flags = parseFlags(process.argv.slice(2));
const task = requireFlag(flags, "task");
const role = requireFlag(flags, "role");
const timeoutMs = parseDuration(flags.timeout, 4 * 3_600_000);
const idleMs = parseDuration(flags.idle, 15 * 60_000);
const intervalMs = parseDuration(flags.interval, 30_000);
const expect = typeof flags.expect === "string" ? flags.expect : undefined;
const session = sessionName(task);
const target = `=${session}:${role}`;
const file = statusFile(task, role);

const SPAWN_GRACE_MS = 120_000;

const started = Date.now();
let windowSeen = false;
let lastChange = Date.now();
let lastHash;
let lastBeat = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(kind, code, details) {
    console.log(`EVENT: ${kind} (${role} of task ${task}, after ${formatDuration(Date.now() - started)})`);
    if (details) console.log(details);
    process.exit(code);
}

for (;;) {
    if (existsSync(file)) {
        // Written atomically (status.mjs), so a present file is a whole file.
        const text = readFileSync(file, "utf8").trim();
        let status;
        try {
            status = JSON.parse(text).status;
        } catch {
            finish("status", 0, text);
        }
        // `--expect done` while the file still says ready-for-test: not the event we wait for.
        if (expect === undefined || status === expect || status === "returned") finish("status", 0, text);
    }
    if (!tmuxHasSession(session)) finish("window-gone", 10, `tmux session ${session} is gone`);
    const win = tmuxWindows(session).find((w) => w.name === role);
    if (win === undefined) {
        if (windowSeen || Date.now() - started >= SPAWN_GRACE_MS) finish("window-gone", 10, `window ${target} is gone`);
        await sleep(Math.min(intervalMs, 5_000));
        continue;
    }
    windowSeen = true;

    const text = paneText(target) ?? "";
    const hash = createHash("sha1").update(text).digest("hex");
    const running = paneIsRunning(win.panePid);
    if (hash !== lastHash || running) {
        lastHash = hash;
        lastChange = Date.now();
    }
    const quiet = Date.now() - lastChange;
    if (quiet >= idleMs)
        finish(
            "idle",
            11,
            `pane unchanged for ${formatDuration(quiet)} and no command running:\n${paneTail(target, 40) ?? ""}`,
        );
    if (Date.now() - started >= timeoutMs)
        finish("timeout", 12, `no status after ${formatDuration(timeoutMs)}:\n${paneTail(target, 40) ?? ""}`);

    if (Date.now() - lastBeat >= 60_000) {
        lastBeat = Date.now();
        const state = running ? "running a command" : `pane quiet for ${formatDuration(quiet)}`;
        console.log(`waiting for ${role} of task ${task}: ${formatDuration(Date.now() - started)} elapsed, ${state}`);
    }
    await sleep(intervalMs);
}
