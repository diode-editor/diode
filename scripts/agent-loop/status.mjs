#!/usr/bin/env node
/**
 * The contract between the roles: one JSON file per role in the task directory, written
 * atomically, read by wait.mjs. Statuses:
 *   implementer  ready-for-test | done | returned
 *   tester       approve | bugs | returned
 *
 *   node scripts/agent-loop/status.mjs write --task <N> --role implementer --status ready-for-test \
 *       --pr 123 --branch issue/123 [--note "<free text>"] [--json <file with extra fields, e.g. bugs>]
 *   node scripts/agent-loop/status.mjs read --task <N> --role tester
 *
 * `bugs` (tester, status bugs) is a JSON array of { title, test, note } — `test` is the path
 * of the failing test on the branch issue/<N>/tests.
 */
import { readFileSync } from "node:fs";

import { ROLES, nowIso, parseFlags, readJson, requireFlag, statusFile, writeJsonAtomic } from "./lib.mjs";

const STATUSES = {
    implementer: ["ready-for-test", "done", "returned"],
    tester: ["approve", "bugs", "returned"],
};

const flags = parseFlags(process.argv.slice(2));
const [action] = flags._;
const task = requireFlag(flags, "task");
const role = requireFlag(flags, "role");
const fail = (msg) => {
    console.error(`status: ${msg}`);
    process.exit(2);
};
if (!ROLES.includes(role)) fail(`unknown role ${role}`);
const file = statusFile(task, role);

if (action === "read") {
    const s = readJson(file, undefined);
    if (s === undefined) fail(`no status for ${role} of task ${task} (${file})`);
    console.log(JSON.stringify(s, null, 2));
} else if (action === "write") {
    const status = requireFlag(flags, "status");
    if (!STATUSES[role].includes(status)) fail(`status for ${role} must be one of ${STATUSES[role].join(", ")}`);
    const extra = typeof flags.json === "string" ? JSON.parse(readFileSync(flags.json, "utf8")) : {};
    const record = { role, task: Number(task), status, at: nowIso(), ...extra };
    for (const key of ["pr", "branch", "note", "question"]) {
        if (typeof flags[key] === "string") record[key] = key === "pr" ? Number(flags[key]) : flags[key];
    }
    if (status === "returned" && record.question === undefined && record.note === undefined) {
        fail("a returned status needs --question (what the human must answer)");
    }
    if (status === "bugs" && !Array.isArray(record.bugs)) fail("status bugs needs --json <file> with a `bugs` array");
    writeJsonAtomic(file, record);
    console.log(`wrote ${file}`);
} else {
    fail("usage: status.mjs read|write --task <N> --role <role> [...]");
}
