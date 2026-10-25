#!/usr/bin/env node
/**
 * One JSON with everything a /dispatch tick needs to decide: machine load, limits and the
 * resulting `canStart` verdict, task tmux sessions, issues in progress (with claim time and
 * whether their session is alive), the ordered queue of ready issues (with `sessionAlive` for
 * one that is in fact running here under the wrong label), status files and worktrees. The skill reads it, decides by text rules, and acts through the sibling scripts.
 *
 *   node scripts/agent-loop/facts.mjs            full JSON
 *   node scripts/agent-loop/facts.mjs --brief    machine + verdict + queue heads only
 */
import { cpus } from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
    HTTPS_ORIGIN,
    LABELS,
    ROLES,
    branchName,
    gh,
    ghJson,
    git,
    latestHandoff,
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
        maxTasks: num("AGENT_LOOP_MAX_TASKS", 2),
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

/**
 * The claim that owns the task now: the first one after the last hand-off (`returned:` /
 * `requeued:`). Claims of earlier runs belong to those runs — counting the age from the very
 * first claim made a resumed task look expired minutes after it was resumed.
 */
function claimOf(comments) {
    const handoff = latestHandoff(comments);
    const claims = comments
        .slice(handoff === undefined ? 0 : handoff.index + 1)
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

function inProgress(lim, hostname) {
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
        // Dispatchers run on several machines: a task claimed elsewhere has its session there,
        // so `sessionAlive: false` means nothing here. Only its owner sweeps a task; an expired
        // one is swept by anyone, because an owner that is gone for good would never do it.
        const mine = claim === undefined || claim.host === hostname;
        return {
            number: i.number,
            title: i.title,
            url: i.url,
            labels: i.labels.map((l) => l.name),
            claim,
            mine,
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

/**
 * Blockers of an issue: GitHub's native dependencies ("Blocked by" in the UI) plus a
 * `Blocked by #A, #B` line in the body. Each as { number, state }; `blocked` while any is open.
 */
function blockers(issue, repo) {
    const byNumber = new Map();
    const native = gh(["api", `repos/${repo}/issues/${issue.number}/dependencies/blocked_by`]);
    if (native.ok) {
        try {
            for (const b of JSON.parse(native.stdout)) byNumber.set(b.number, { number: b.number, state: b.state });
        } catch {
            // the endpoint answered with something unexpected: body text still counts
        }
    }
    const line = /blocked by:?\s*((?:#\d+[,\s]*)+)/i.exec(issue.body ?? "");
    for (const m of line === null ? [] : line[1].matchAll(/#(\d+)/g)) {
        const n = Number(m[1]);
        if (byNumber.has(n)) continue;
        const res = gh(["issue", "view", String(n), "--json", "state", "--jq", ".state"]);
        byNumber.set(n, { number: n, state: res.ok ? res.stdout.trim().toLowerCase() : "unknown" });
    }
    const list = [...byNumber.values()];
    return { blockedBy: list, blocked: list.some((b) => b.state !== "closed") };
}

function queue(sess) {
    const repo = ghJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
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
        "number,title,labels,createdAt,url,body",
    ]);
    const eligible = issues
        .map((i) => ({ ...i, labels: i.labels.map((l) => l.name) }))
        .filter((i) => !i.labels.includes(LABELS.inProgress) && !i.labels.includes(LABELS.returned));
    const remoteBranches = git(["ls-remote", "--heads", HTTPS_ORIGIN, "issue/*"]).stdout;
    const all = eligible
        .map((i) => ({
            number: i.number,
            title: i.title,
            url: i.url,
            labels: i.labels,
            createdAt: i.createdAt,
            branch: branchName(i.number),
            // A branch on origin: the task was in the loop before and start-task.mjs resumes it.
            branchExists: new RegExp(`\\srefs/heads/${branchName(i.number)}(\\s|$)`).test(remoteBranches),
            // A live `task-<N>` session on this host under a `ready to implement` label: the task is
            // running and only mislabelled (a mistaken sweep elsewhere) — reclaim-task.mjs, not start.
            sessionAlive: sess.some((s) => s.task === i.number),
            sessionSince: sess.find((s) => s.task === i.number)?.createdAt,
            ...blockers(i, repo),
        }))
        // Finishing what is half done comes before starting anew; then bugs; then the oldest.
        .sort((a, b) => {
            const resume = Number(b.branchExists) - Number(a.branchExists);
            if (resume !== 0) return resume;
            const bug = Number(b.labels.includes(LABELS.bug)) - Number(a.labels.includes(LABELS.bug));
            return bug !== 0 ? bug : a.createdAt.localeCompare(b.createdAt);
        });
    return { queue: all.filter((i) => !i.blocked), blocked: all.filter((i) => i.blocked) };
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
    inProgress: inProgress(lim, m.hostname),
    ...queue(sess),
    taskDirs: taskDirs(),
    worktrees: worktrees(),
};
if (flags.brief) {
    facts.queue = facts.queue.slice(0, 3);
    facts.blocked = facts.blocked.map((i) => ({ number: i.number, blockedBy: i.blockedBy }));
    delete facts.worktrees;
    delete facts.taskDirs;
}
console.log(JSON.stringify(facts, null, 2));
