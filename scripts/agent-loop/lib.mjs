// Shared helpers of the agent loop (scripts/agent-loop/README.md): paths, JSON files,
// shell calls, tmux and worktree inventory. Everything here is deliberately small and
// defensive: a broken helper must fail loudly, not leave a task half-swept.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import path from "node:path";

/** The main checkout, even when the script runs from a worktree (its .claude/worktrees live under the main one). */
export const REPO_ROOT = (() => {
    const here = path.resolve(import.meta.dirname, "..", "..");
    const res = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: here, encoding: "utf8" });
    if (res.status !== 0) return here;
    return path.dirname(path.resolve(here, res.stdout.trim()));
})();
/** Pushes go over https: loop machines have no ssh key (.claude/hooks/bash-guard.mjs). */
export const HTTPS_ORIGIN = "https://github.com/diode-editor/diode.git";
export const LABELS = { ready: "ready to implement", inProgress: "in progress", returned: "returned", bug: "bug" };
export const ROLES = ["implementer", "tester"];
/** Loop commits are Claude's alone: the human's git identity stays out of author and committer. */
export const CLAUDE_GIT_EMAIL = "noreply@anthropic.com";
export const CLAUDE_GIT_ENV = {
    GIT_AUTHOR_NAME: "Claude",
    GIT_AUTHOR_EMAIL: CLAUDE_GIT_EMAIL,
    GIT_COMMITTER_NAME: "Claude",
    GIT_COMMITTER_EMAIL: CLAUDE_GIT_EMAIL,
};
/** Exit code of mutation-budget.mjs when the task's budget is spent (75 is the lease's "busy"). */
export const EXIT_BUDGET_SPENT = 76;

export function loopHome() {
    return process.env.AGENT_LOOP_HOME ?? path.join(homedir(), ".claude", "agent-loop");
}

export function taskDir(task) {
    const dir = path.join(loopHome(), "tasks", String(task));
    mkdirSync(dir, { recursive: true });
    return dir;
}

export function sessionName(task) {
    return `task-${task}`;
}

export function branchName(task) {
    return `issue/${task}`;
}

export function host() {
    return process.env.AGENT_LOOP_HOST ?? hostname();
}

export function nowIso() {
    return new Date().toISOString();
}

/** `--flag value` / `--flag=value` / `--flag` (true); positional words go to `_`; `--` ends parsing (rest in `rest`). */
export function parseFlags(argv) {
    const out = { _: [], rest: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--") {
            out.rest = argv.slice(i + 1);
            break;
        }
        if (!a.startsWith("--")) {
            out._.push(a);
            continue;
        }
        const eq = a.indexOf("=");
        if (eq > 0) {
            out[a.slice(2, eq)] = a.slice(eq + 1);
        } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
            out[a.slice(2)] = argv[++i];
        } else {
            out[a.slice(2)] = true;
        }
    }
    return out;
}

/** `--task` falls back to $AGENT_LOOP_TASK, which the task's tmux session carries. */
export function requireFlag(flags, name) {
    const v = flags[name] ?? (name === "task" ? process.env.AGENT_LOOP_TASK : undefined);
    if (v === undefined || v === true || v === "") {
        console.error(`missing --${name}`);
        process.exit(2);
    }
    return String(v);
}

/** "4h", "15m", "90s", "600" (seconds) → milliseconds. */
export function parseDuration(text, fallback) {
    if (text === undefined || text === true) return fallback;
    const m = /^(\d+(?:\.\d+)?)\s*(h|m|s)?$/.exec(String(text).trim());
    if (m === null) throw new Error(`bad duration: ${text}`);
    const n = Number(m[1]);
    const unit = { h: 3_600_000, m: 60_000, s: 1000 }[m[2] ?? "s"];
    return Math.round(n * unit);
}

export function formatDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 90) return `${s}s`;
    const m = Math.round(s / 60);
    if (m < 90) return `${m}m`;
    return `${(m / 60).toFixed(1)}h`;
}

export function readJson(file, fallback) {
    try {
        return JSON.parse(readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

/** Temp file + rename: a reader never sees half a file. */
export function writeJsonAtomic(file, value) {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
    renameSync(tmp, file);
}

export function statusFile(task, role) {
    return path.join(taskDir(task), `${role}.json`);
}

/** Run a command, return stdout; `ok: false` instead of a throw when it fails. */
export function sh(cmd, args, opts = {}) {
    const res = spawnSync(cmd, args, {
        encoding: "utf8",
        cwd: opts.cwd ?? REPO_ROOT,
        timeout: opts.timeout ?? 60_000,
        maxBuffer: 1 << 26,
    });
    if (res.error !== undefined) return { ok: false, stdout: "", stderr: String(res.error) };
    return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
}

export function gh(args, opts) {
    return sh("gh", args, { timeout: 120_000, ...opts });
}

export function ghJson(args) {
    const res = gh(args);
    if (!res.ok) throw new Error(`gh ${args.join(" ")} failed: ${res.stderr.trim()}`);
    return JSON.parse(res.stdout || "null");
}

export function git(args, opts) {
    return sh("git", args, opts);
}

// --- tmux -------------------------------------------------------------------------

export function tmux(args) {
    return sh("tmux", args, { timeout: 10_000 });
}

export function tmuxSessions() {
    const res = tmux(["list-sessions", "-F", "#{session_name}\t#{session_created}"]);
    if (!res.ok) return [];
    return res.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const [name, created] = line.split("\t");
            return { name, createdAt: new Date(Number(created) * 1000).toISOString() };
        });
}

export function tmuxWindows(session) {
    const res = tmux(["list-windows", "-t", `=${session}`, "-F", "#{window_name}\t#{pane_pid}"]);
    if (!res.ok) return [];
    return res.stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
            const [name, pid] = line.split("\t");
            return { name, panePid: Number(pid) };
        });
}

export function tmuxHasSession(session) {
    return tmux(["has-session", "-t", `=${session}`]).ok;
}

/** Non-blank lines of the pane as one string, or undefined when the window is gone. */
export function paneText(target, lines = 200) {
    const res = tmux(["capture-pane", "-p", "-t", target, "-S", `-${lines}`]);
    if (!res.ok) return undefined;
    return res.stdout
        .split("\n")
        .filter((l) => l.trim() !== "")
        .join("\n");
}

export function paneTail(target, lines = 40) {
    const text = paneText(target);
    if (text === undefined) return undefined;
    return text.split("\n").slice(-lines).join("\n");
}

// --- processes ---------------------------------------------------------------------

/** All descendants of `pid` as { pid, ppid, comm, args }. */
export function descendants(pid) {
    const res = sh("ps", ["-eo", "pid=,ppid=,comm=,args="], { timeout: 10_000 });
    if (!res.ok) return [];
    const all = res.stdout
        .trim()
        .split("\n")
        .map((line) => {
            const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
            return m === null ? undefined : { pid: Number(m[1]), ppid: Number(m[2]), comm: m[3], args: m[4] };
        })
        .filter(Boolean);
    const out = [];
    const queue = [pid];
    while (queue.length > 0) {
        const p = queue.shift();
        for (const proc of all) {
            if (proc.ppid === p) {
                out.push(proc);
                queue.push(proc.pid);
            }
        }
    }
    return out;
}

/**
 * Claude's Bash tool runs as `bash -c source …/shell-snapshots/…`, and a long wait (lease
 * queue, CI watch, wait.mjs) lives inside it. An idle claude has no such child.
 */
export function paneIsRunning(panePid) {
    return descendants(panePid).some((p) => /shell-snapshots/.test(p.args) || /^(bash|sh|zsh)$/.test(p.comm));
}

/** Processes whose cwd is inside `dir` (another session working there). */
export function processesIn(dir) {
    const out = [];
    let pids = [];
    try {
        pids = readdirSync("/proc").filter((n) => /^\d+$/.test(n));
    } catch {
        return out;
    }
    const root = path.resolve(dir);
    const prefix = root + path.sep;
    for (const pid of pids) {
        try {
            const cwd = readlinkSync(`/proc/${pid}/cwd`);
            if (cwd === root || cwd.startsWith(prefix)) out.push(Number(pid));
        } catch {
            // vanished or not ours
        }
    }
    return out;
}

// --- worktrees ---------------------------------------------------------------------

export const WORKTREES_DIR = path.join(REPO_ROOT, ".claude", "worktrees");

/**
 * Head branches of merged PRs. PRs are squash-merged, so `merge-base --is-ancestor` cannot tell a
 * merged branch from an unmerged one; the PR state can. Undefined when gh is unavailable.
 */
export function mergedHeads() {
    const res = gh(["pr", "list", "--state", "merged", "--limit", "300", "--json", "headRefName"]);
    if (!res.ok) return undefined;
    try {
        return new Set(JSON.parse(res.stdout).map((p) => p.headRefName));
    } catch {
        return undefined;
    }
}

/** Worktrees under .claude/worktrees with branch, merged (PR merged), dirty and busy flags. */
export function worktrees(merged = mergedHeads()) {
    const res = git(["worktree", "list", "--porcelain"]);
    if (!res.ok) return [];
    const out = [];
    let cur;
    for (const line of res.stdout.split("\n")) {
        if (line.startsWith("worktree ")) {
            cur = { path: line.slice(9), branch: undefined };
            out.push(cur);
        } else if (line.startsWith("branch ") && cur !== undefined) {
            cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
        }
    }
    const prefix = WORKTREES_DIR + path.sep;
    return out
        .filter((w) => w.path.startsWith(prefix))
        .map((w) => {
            const exists = existsSync(w.path);
            return {
                ...w,
                exists,
                merged: w.branch !== undefined && merged !== undefined && merged.has(w.branch),
                dirty: exists ? git(["status", "--porcelain"], { cwd: w.path }).stdout.trim() !== "" : false,
                busy: exists ? processesIn(w.path).length : 0,
            };
        });
}
