#!/usr/bin/env node
/**
 * Runs a CI gate on your branch without a PR (`workflow_dispatch`) and returns the verdict as
 * the exit code: the GitHub runner is free while the local machine is busy under a lease.
 * Run logs and artifacts go to `reports/ci/<run id>/`.
 *
 * Usage:
 *   node scripts/ci-run.mjs <gate> [--base <sha>] [--no-push] [--tail <lines>]
 *   gate: all | static | test | mutation | e2e | e2e-windows
 *
 *   --base     diff base of the mutation gate; merge-base with origin/main by default
 *   --no-push  the branch is already pushed (we still check that the remote is exactly HEAD)
 *   --tail     how many log lines of failed steps to print (200 by default)
 *
 * Exit code: 0 for a green gate, 1 for red, 2 when the run did not happen (usage error,
 * push, dispatch). Run it in the background: a run takes minutes.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const GATES = ["all", "static", "test", "mutation", "e2e", "e2e-windows"];
const WORKFLOW = "ci.yml";
const POLL_MS = 30_000;
const FIND_TIMEOUT_MS = 120_000;

const repoRoot = path.resolve(import.meta.dirname, "..");

function fail(message) {
    console.error(`ci-run: ${message}`);
    process.exit(2);
}

function run(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function tryRun(cmd, args) {
    try {
        return run(cmd, args);
    } catch {
        return undefined;
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const argv = process.argv.slice(2);
let gate;
let base;
let push = true;
let tail = 200;
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") base = argv[++i];
    else if (a === "--no-push") push = false;
    else if (a === "--tail") tail = Number(argv[++i]);
    else if (gate === undefined && !a.startsWith("-")) gate = a;
    else fail(`unknown argument: ${a}`);
}
if (gate === undefined || !GATES.includes(gate)) fail(`specify a gate: ${GATES.join(" | ")}`);
if (!Number.isInteger(tail) || tail < 0) fail("--tail expects a number of lines");

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch === "HEAD") fail("detached HEAD: check out a branch");
if (branch === "main" && push) fail("not pushing to main; a push to main runs the gate itself");
const head = run("git", ["rev-parse", "HEAD"]);

// The diode origin is ssh, but we push over https: take owner/repo from any URL form.
const originUrl = run("git", ["remote", "get-url", "origin"]);
const repo = /github\.com[:/](.+?)(?:\.git)?$/.exec(originUrl)?.[1];
if (repo === undefined) fail(`origin is not on GitHub: ${originUrl}`);
const httpsUrl = `https://github.com/${repo}.git`;

if (run("git", ["status", "--porcelain", "--untracked-files=no"]) !== "") {
    console.error("ci-run: the working tree has uncommitted changes, only HEAD goes to CI");
}

if (push) {
    console.log(`push ${branch} → ${httpsUrl}`);
    const res = spawnSync("git", ["push", httpsUrl, `HEAD:refs/heads/${branch}`], { cwd: repoRoot, stdio: "inherit" });
    if (res.status !== 0) {
        fail(
            "push failed. Was the branch rewritten (rebase/amend)? Push it yourself with an explicit SHA:\n" +
                `  git push --force-with-lease=refs/heads/${branch}:<SHA on remote> ${httpsUrl} HEAD:refs/heads/${branch}\n` +
                "and run again with --no-push",
        );
    }
}
const remoteHead = tryRun("git", ["ls-remote", httpsUrl, `refs/heads/${branch}`])?.split(/\s+/)[0];
if (remoteHead !== head) fail(`remote ${branch} = ${remoteHead ?? "<no branch>"}, but HEAD = ${head}: CI would run the wrong commit`);

if ((gate === "mutation" || gate === "all") && base === undefined) {
    if (tryRun("git", ["fetch", "--quiet", "--no-prune", "origin", "main"]) === undefined) {
        console.error("ci-run: git fetch origin main failed, using merge-base with the local origin/main");
    }
    base = tryRun("git", ["merge-base", "origin/main", "HEAD"]);
    if (base === undefined) fail("no merge-base with origin/main, pass --base <sha>");
}

const token = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const fields = ["-f", `gate=${gate}`, "-f", `token=${token}`];
if (base !== undefined) fields.push("-f", `base=${base}`);
console.log(`dispatch ${WORKFLOW} gate=${gate}${base !== undefined ? ` base=${base.slice(0, 10)}` : ""} token=${token}`);
try {
    run("gh", ["workflow", "run", WORKFLOW, "-R", repo, "--ref", branch, ...fields]);
} catch (err) {
    fail(`gh workflow run: ${err.stderr || err.message}`);
}

// The dispatch response carries no run id: find ours by the token in its name (run-name in ci.yml).
function gh(args) {
    return JSON.parse(run("gh", [...args, "-R", repo]));
}

let runId;
let runUrl;
for (const deadline = Date.now() + FIND_TIMEOUT_MS; runId === undefined; ) {
    if (Date.now() > deadline) fail(`run with token=${token} did not appear within ${FIND_TIMEOUT_MS / 1000} s`);
    await sleep(5_000);
    const runs = gh(["run", "list", "--workflow", WORKFLOW, "--branch", branch, "--event", "workflow_dispatch", "-L", "30", "--json", "databaseId,displayTitle,url"]);
    const mine = runs.find((r) => r.displayTitle.includes(token));
    runId = mine?.databaseId;
    runUrl = mine?.url;
}
console.log(`run ${runId}: ${runUrl}`);

// Not `gh run watch`: without a TTY it reprints the whole table every tick, bloating the background task log.
const seen = new Map();
let view;
for (;;) {
    try {
        view = gh(["run", "view", String(runId), "--json", "status,conclusion,jobs"]);
    } catch (err) {
        console.error(`ci-run: gh run view: ${err.stderr || err.message}, retrying`);
        await sleep(POLL_MS);
        continue;
    }
    for (const job of view.jobs) {
        const state = job.conclusion || job.status;
        if (seen.get(job.name) !== state) {
            seen.set(job.name, state);
            console.log(`  ${new Date().toISOString().slice(11, 19)} ${job.name}: ${state}`);
        }
    }
    if (view.status === "completed") break;
    await sleep(POLL_MS);
}

const ok = view.conclusion === "success";
const outDir = path.join(repoRoot, "reports", "ci", String(runId));
console.log(`\n${ok ? "GREEN" : "RED"}: ${view.conclusion} — ${runUrl}`);
for (const job of view.jobs) console.log(`  ${(job.conclusion || job.status).padEnd(9)} ${job.name}`);

// Artifacts matter on green too (the Stryker report); there may be none at all.
if (tryRun("gh", ["run", "download", String(runId), "-R", repo, "-D", outDir]) !== undefined) {
    console.log(`artifacts: ${path.relative(repoRoot, outDir)}/`);
}

// Not `--log-failed`: gate steps run with continue-on-error, so only the final `Gate` counts as
// failed, while the error itself is in the step with `##[error]`.
if (!ok) {
    mkdirSync(outDir, { recursive: true });
    for (const job of view.jobs.filter((j) => j.conclusion !== "success" && j.conclusion !== "skipped")) {
        const log = tryRun("gh", ["run", "view", "-R", repo, "--job", String(job.databaseId), "--log"]);
        if (log === undefined || log === "") continue;
        const logPath = path.join(outDir, `${job.name.replace(/[^\w.-]+/g, "_")}.log`);
        writeFileSync(logPath, `${log}\n`);
        // A log line: `<job>\t<step>\t<time> <text>`.
        const steps = new Map();
        for (const line of log.split("\n")) {
            const [, step = "", rest = ""] = line.split("\t");
            const text = rest.replace(/^\S+Z /, "").replace(/(?:\x1b|\^\[)\[[0-9;]*m/g, "");
            if (!steps.has(step)) steps.set(step, []);
            steps.get(step).push(text);
        }
        console.log(`\n══ ${job.name}: ${job.conclusion} — full log: ${path.relative(repoRoot, logPath)}`);
        for (const [step, lines] of steps) {
            if (!lines.some((l) => l.startsWith("##[error]"))) continue;
            console.log(`── ${step} (last ${Math.min(tail, lines.length)} of ${lines.length} lines) ──`);
            console.log(lines.slice(-tail).join("\n"));
        }
    }
}
process.exit(ok ? 0 : 1);
