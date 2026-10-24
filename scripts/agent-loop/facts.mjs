#!/usr/bin/env node
/**
 * One JSON with everything a /dispatch tick needs to decide: machine load, limits and the
 * resulting `canStart` verdict, task tmux sessions, issues in progress (with claim time and
 * whether their session is alive), the ordered queue of ready issues, status files and
 * worktrees. The skill reads it, decides by text rules, and acts through the sibling scripts.
 *
 *   node scripts/agent-loop/facts.mjs            full JSON
 *   node scripts/agent-loop/facts.mjs --brief    machine + verdict + queue heads only
 */
import { cpus } from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
    LABELS,
    ROLES,
    branchName,
    ghJson,
    git,
    loopHome,
    nowIso,
    parseFlags,
    readJson,
    sessionName,
    sh,
    statusFile,
    tmuxHasSession,
    tmuxSessions,
    tmuxWindows,
    worktrees,
} from "./lib.mjs";

const flags = parseFlags(process.argv.slice(2));

const num = (name, fallback) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
};

function machine() {
    const nproc = cpus().length;
    const load = readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/).slice(0, 3).map(Number);
    const mem = Object.fromEntries(
        readFileSync("/proc/meminfo", "utf8")
            .split("\n")
            .filter(Boolean)
            .map((l) => {
                const [k, v] = l.split(":");
                return [k.trim(), Number(v.trim().split(/\s+/)[0]) / 1024];
            }),
    );
    const df = sh("df", ["-Pk", loopHome()]).stdout.trim().split("\n").pop()?.split(/\s+/) ?? [];
    const lease = sh("claude-lease", ["status"]);
    return {
        hostname: process.env.AGENT_LOOP_HOST ?? sh("hostname", []).stdout.trim(),
        nproc,
        load1: load[0],
        load5: load[1],
        load15: load[2],
        memTotalMb: Math.round(mem.MemTotal ?? 0),
        memAvailableMb: Math.round(mem.MemAvailable ?? 0),
        memAvailablePct: mem.MemTotal ? Math.round(((mem.MemAvailable ?? 0) / mem.MemTotal) * 100) : undefined,
        diskFreeGb: df[3] !== undefined ? Math.round(Number(df[3]) / 1024 / 1024) : undefined,
        lease: lease.ok ? lease.stdout.trim() : `claude-lease unavailable: ${lease.stderr.trim() || "not in PATH"}`,
    };
}

function limits(m) {
    return {
        maxTasks: num("AGENT_LOOP_MAX_TASKS", 3),
        load5Max: num("AGENT_LOOP_LOAD5_MAX", m.nproc / 2),
        memAvailableMinPct: num("AGENT_LOOP_MEM_MIN_PCT", 30),
        taskTimeoutHours: num("AGENT_LOOP_TASK_TIMEOUT_HOURS", 8),
        mutationBudgetMin: num("AGENT_LOOP_MUTATION_BUDGET_MIN", 20),
        model: process.env.AGENT_LOOP_MODEL ?? "opus",
    };
}

function sessions() {
    return tmuxSessions()
        .filter((s) => /^task-\d+$/.test(s.name))
        .map((s) => ({ ...s, task: Number(s.name.slice(5)), windows: tmuxWindows(s.name).map((w) => w.name) }));
}

function claimOf(comments) {
    const claims = comments
        .map((c) => ({ m: /^claim:\s*(\S+)\s+(\S+)/m.exec(c.body ?? ""), createdAt: c.createdAt }))
        .filter((c) => c.m !== null)
        .map((c) => ({ host: c.m[1], at: c.m[2], commentedAt: c.createdAt }));
    return claims[0];
}

function statuses(task) {
    const out = {};
    for (const role of ROLES) {
        const s = readJson(statusFile(task, role), undefined);
        if (s !== undefined) out[role] = s;
    }
    return out;
}

function inProgress(lim) {
    const issues = ghJson([
        "issue",
        "list",
        "--state",
        "open",
        "--label",
        LABELS.inProgress,
        "--limit",
        "50",
        "--json",
        "number,title,labels,url",
    ]);
    return issues.map((i) => {
        const comments = ghJson(["issue", "view", String(i.number), "--json", "comments", "--jq", ".comments"]) ?? [];
        const claim = claimOf(comments);
        const takenAt = claim?.at ?? claim?.commentedAt;
        const ageHours = takenAt ? (Date.now() - new Date(takenAt).getTime()) / 3_600_000 : undefined;
        const session = sessionName(i.number);
        const alive = tmuxHasSession(session);
        const windows = alive ? tmuxWindows(session).map((w) => w.name) : [];
        return {
            number: i.number,
            title: i.title,
            url: i.url,
            labels: i.labels.map((l) => l.name),
            claim,
            takenAt,
            ageHours: ageHours === undefined ? undefined : Math.round(ageHours * 10) / 10,
            expired: ageHours !== undefined && ageHours > lim.taskTimeoutHours,
            session,
            sessionAlive: alive,
            windows,
            managerAlive: windows.includes("manager"),
            statuses: statuses(i.number),
        };
    });
}

function queue() {
    const issues = ghJson([
        "issue",
        "list",
        "--state",
        "open",
        "--label",
        LABELS.ready,
        "--limit",
        "100",
        "--json",
        "number,title,labels,createdAt,url",
    ]);
    const eligible = issues
        .map((i) => ({ ...i, labels: i.labels.map((l) => l.name) }))
        .filter((i) => !i.labels.includes(LABELS.inProgress) && !i.labels.includes(LABELS.returned))
        .sort((a, b) => {
            const bug = Number(b.labels.includes(LABELS.bug)) - Number(a.labels.includes(LABELS.bug));
            return bug !== 0 ? bug : a.createdAt.localeCompare(b.createdAt);
        });
    const remoteBranches = git(["ls-remote", "--heads", "origin", "issue/*"]).stdout;
    return eligible.map((i) => ({
        number: i.number,
        title: i.title,
        url: i.url,
        labels: i.labels,
        createdAt: i.createdAt,
        branch: branchName(i.number),
        branchExists: new RegExp(`\\srefs/heads/${branchName(i.number)}(\\s|$)`).test(remoteBranches),
    }));
}

function taskDirs() {
    try {
        return readdirSync(path.join(loopHome(), "tasks"))
            .filter((n) => /^\d+$/.test(n))
            .map(Number);
    } catch {
        return [];
    }
}

const m = machine();
const lim = limits(m);
const sess = sessions();
const running = sess.length;
const reasons = [];
if (running >= lim.maxTasks) reasons.push(`running ${running} >= maxTasks ${lim.maxTasks}`);
if (m.load5 >= lim.load5Max) reasons.push(`load5 ${m.load5} >= ${lim.load5Max}`);
if ((m.memAvailablePct ?? 0) < lim.memAvailableMinPct) {
    reasons.push(`memAvailable ${m.memAvailablePct}% < ${lim.memAvailableMinPct}%`);
}
const facts = {
    now: nowIso(),
    machine: m,
    limits: lim,
    verdict: { canStart: reasons.length === 0, runningTasks: running, reasons },
    sessions: sess,
    inProgress: inProgress(lim),
    queue: queue(),
    taskDirs: taskDirs(),
    worktrees: worktrees(),
};
if (flags.brief) {
    facts.queue = facts.queue.slice(0, 3);
    delete facts.worktrees;
    delete facts.taskDirs;
}
console.log(JSON.stringify(facts, null, 2));
