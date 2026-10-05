// Общее для git-помощников `npm run git:*` (docs/PR.md, «Стек PR, rebase и push»).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** origin в checkout'ах — ssh, а ssh живёт только с проброшенным агентом: сеть — по https. */
// DIODE_GIT_URL — подмена для проверки помощников на локальном bare-репозитории.
export const REPO_URL = process.env.DIODE_GIT_URL ?? "https://github.com/diode-editor/diode.git";

/**
 * Помощники ходят в сеть по REPO_URL, а не по origin, поэтому сначала
 * убеждаемся, что этот checkout — и правда diode: иначе запуск из чужого
 * клона (или песочницы без DIODE_GIT_URL) пушнул бы его ветки в diode.
 */
export function assertDiodeCheckout() {
    if (process.env.DIODE_GIT_URL !== undefined) return;
    const r = cap("git", ["remote", "get-url", "origin"], { allowFail: true });
    if (!r.ok || !/github\.com[:/]diode-editor\/diode(\.git)?$/.test(r.out)) {
        die(`origin этого checkout'а — «${r.out || "нет"}», а не diode-editor/diode: git:* работают только в diode.`);
    }
}

export function die(msg, code = 1) {
    console.error(msg);
    process.exit(code);
}

/** Запуск с захватом вывода; бросает при ненулевом коде, если не `allowFail`. */
export function cap(cmd, args, { allowFail = false, input } = {}) {
    const r = spawnSync(cmd, args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0 && !allowFail) {
        throw new Error(`${cmd} ${args.join(" ")}: ${(r.stderr || r.stdout).trim()}`);
    }
    return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

/** Запуск с выводом в терминал, эхо команды; код выхода — наружу. */
export function loud(cmd, args) {
    console.log(`> ${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (r.error) throw r.error;
    return r.status ?? 1;
}

export const git = (...args) => cap("git", args).out;
export const gitOk = (...args) => cap("git", args, { allowFail: true }).ok;

export function isAncestor(a, b) {
    return gitOk("merge-base", "--is-ancestor", a, b);
}

export function short(sha) {
    return sha.slice(0, 10);
}

/** SHA ветки на сервере (по https), `undefined` — ветки там нет. */
export function remoteSha(branch) {
    const out = git("ls-remote", REPO_URL, `refs/heads/${branch}`);
    return out === "" ? undefined : out.split(/\s+/)[0];
}

// Ожидаемый SHA ветки на сервере, снятый git:stack-rebase ДО переписывания
// истории. git:push отдаёт его в --force-with-lease: снятый в момент push он
// ничего бы не защищал. Лежит в git-каталоге worktree, не в дереве.
function leaseFile(branch) {
    return path.join(git("rev-parse", "--git-common-dir"), "diode-push-lease", branch.replaceAll("/", "__"));
}

export function saveLease(branch, sha) {
    const file = leaseFile(branch);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${sha ?? ""}\n`);
}

/** `undefined` — записи нет; `""` — на момент записи ветки на сервере не было. */
export function loadLease(branch) {
    try {
        return readFileSync(leaseFile(branch), "utf8").trim();
    } catch {
        return undefined;
    }
}

export function dropLease(branch) {
    rmSync(leaseFile(branch), { force: true });
}

export function currentBranch() {
    const b = git("branch", "--show-current");
    if (b === "") die("HEAD отвязан от ветки — укажи ветку явно.");
    return b;
}

export function sleep(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
