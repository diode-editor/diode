#!/usr/bin/env node
/**
 * Прогнать гейт CI на своей ветке без PR и дождаться вердикта.
 *
 * Тяжёлые гейты (мутационный, e2e, покрытие) на общей маленькой машине идут под
 * лизой и по одному; раннер GitHub — это ещё одна машина, свободная всегда.
 * Скрипт пушит текущую ветку, запускает `ci.yml` вручную (`workflow_dispatch`)
 * с выбранным гейтом, ждёт конца и возвращает его вердикт кодом выхода. На
 * провале — хвост логов упавших шагов в консоль, логи целиком и артефакты
 * прогона (отчёт Stryker, лог e2e) в `reports/ci/<run id>/`.
 *
 * Использование:
 *   node scripts/ci-run.mjs <gate> [--base <sha>] [--no-push] [--tail <строк>]
 *   gate: all | static | test | mutation | e2e | e2e-windows
 *
 *   --base     база диффа мутационного гейта; по умолчанию merge-base с origin/main
 *   --no-push  ветка уже запушена (иначе проверим, что на remote ровно HEAD)
 *   --tail     сколько строк лога упавших шагов печатать (по умолчанию 200)
 *
 * Код выхода: 0 — гейт зелёный, 1 — красный, 2 — прогон не состоялся (ошибка
 * использования, push, dispatch). Запускать в фоне: прогон идёт минуты.
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

// ── аргументы ──
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
    else fail(`непонятный аргумент: ${a}`);
}
if (gate === undefined || !GATES.includes(gate)) fail(`укажи гейт: ${GATES.join(" | ")}`);
if (!Number.isInteger(tail) || tail < 0) fail("--tail ждёт число строк");

// ── ветка и репозиторий ──
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
if (branch === "HEAD") fail("detached HEAD — нужен checkout ветки");
if (branch === "main" && push) fail("в main не пушим; гейт на main гоняет сам push в main");
const head = run("git", ["rev-parse", "HEAD"]);

// origin в diode — ssh, а пушим по https: берём owner/repo из любого вида URL.
const originUrl = run("git", ["remote", "get-url", "origin"]);
const repo = /github\.com[:/](.+?)(?:\.git)?$/.exec(originUrl)?.[1];
if (repo === undefined) fail(`origin не на GitHub: ${originUrl}`);
const httpsUrl = `https://github.com/${repo}.git`;

if (run("git", ["status", "--porcelain", "--untracked-files=no"]) !== "") {
    console.error("ci-run: в рабочем дереве есть незакоммиченные правки — в CI уедет только HEAD");
}

// ── push ──
if (push) {
    console.log(`push ${branch} → ${httpsUrl}`);
    const res = spawnSync("git", ["push", httpsUrl, `HEAD:refs/heads/${branch}`], { cwd: repoRoot, stdio: "inherit" });
    if (res.status !== 0) {
        fail(
            "push не прошёл. Ветка переписана (rebase/amend)? Запушь сам с явным SHA:\n" +
                `  git push --force-with-lease=refs/heads/${branch}:<SHA на remote> ${httpsUrl} HEAD:refs/heads/${branch}\n` +
                "и запусти снова с --no-push",
        );
    }
}
const remoteHead = tryRun("git", ["ls-remote", httpsUrl, `refs/heads/${branch}`])?.split(/\s+/)[0];
if (remoteHead !== head) fail(`на remote ${branch} = ${remoteHead ?? "<нет ветки>"}, а HEAD = ${head}: CI прогнал бы не то`);

// ── база мутационного гейта ──
if ((gate === "mutation" || gate === "all") && base === undefined) {
    if (tryRun("git", ["fetch", "--quiet", "--no-prune", "origin", "main"]) === undefined) {
        console.error("ci-run: git fetch origin main не прошёл — merge-base по локальному origin/main");
    }
    base = tryRun("git", ["merge-base", "origin/main", "HEAD"]);
    if (base === undefined) fail("нет merge-base с origin/main — передай --base <sha>");
}

// ── dispatch ──
const token = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
const fields = ["-f", `gate=${gate}`, "-f", `token=${token}`];
if (base !== undefined) fields.push("-f", `base=${base}`);
console.log(`dispatch ${WORKFLOW} gate=${gate}${base !== undefined ? ` base=${base.slice(0, 10)}` : ""} token=${token}`);
try {
    run("gh", ["workflow", "run", WORKFLOW, "-R", repo, "--ref", branch, ...fields]);
} catch (err) {
    fail(`gh workflow run: ${err.stderr || err.message}`);
}

// Ответ dispatch'а id прогона не несёт — ищем свой по token в имени (run-name в ci.yml).
function gh(args) {
    return JSON.parse(run("gh", [...args, "-R", repo]));
}

let runId;
let runUrl;
for (const deadline = Date.now() + FIND_TIMEOUT_MS; runId === undefined; ) {
    if (Date.now() > deadline) fail(`прогон с token=${token} не появился за ${FIND_TIMEOUT_MS / 1000} с`);
    await sleep(5_000);
    const runs = gh(["run", "list", "--workflow", WORKFLOW, "--branch", branch, "--event", "workflow_dispatch", "-L", "30", "--json", "databaseId,displayTitle,url"]);
    const mine = runs.find((r) => r.displayTitle.includes(token));
    runId = mine?.databaseId;
    runUrl = mine?.url;
}
console.log(`run ${runId}: ${runUrl}`);

// ── ожидание ──
// Своим опросом, а не `gh run watch`: тот без TTY перепечатывает всю таблицу
// каждый тик, и лог фоновой задачи пухнет. Печатаем только смену статусов job'ов.
const seen = new Map();
let view;
for (;;) {
    try {
        view = gh(["run", "view", String(runId), "--json", "status,conclusion,jobs"]);
    } catch (err) {
        console.error(`ci-run: gh run view: ${err.stderr || err.message} — повторю`);
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

// ── вердикт ──
const ok = view.conclusion === "success";
const outDir = path.join(repoRoot, "reports", "ci", String(runId));
console.log(`\n${ok ? "ЗЕЛЁНЫЙ" : "КРАСНЫЙ"}: ${view.conclusion} — ${runUrl}`);
for (const job of view.jobs) console.log(`  ${(job.conclusion || job.status).padEnd(9)} ${job.name}`);

// Артефакты нужны и на зелёном (отчёт Stryker), их может не быть вовсе.
if (tryRun("gh", ["run", "download", String(runId), "-R", repo, "-D", outDir]) !== undefined) {
    console.log(`артефакты: ${path.relative(repoRoot, outDir)}/`);
}

// Не `--log-failed`: гейты в ci.yml идут шагами с continue-on-error, и упавшим
// там числится только финальный `Gate` — сама ошибка (tsc, Stryker) в его логе
// не видна. Берём лог упавшего job'а целиком и показываем хвост каждого шага,
// где есть `##[error]`: так помечается и шаг, «упавший» под continue-on-error.
if (!ok) {
    mkdirSync(outDir, { recursive: true });
    for (const job of view.jobs.filter((j) => j.conclusion !== "success" && j.conclusion !== "skipped")) {
        const log = tryRun("gh", ["run", "view", "-R", repo, "--job", String(job.databaseId), "--log"]);
        if (log === undefined || log === "") continue;
        const logPath = path.join(outDir, `${job.name.replace(/[^\w.-]+/g, "_")}.log`);
        writeFileSync(logPath, `${log}\n`);
        // Строка лога: `<job>\t<шаг>\t<время> <текст>`.
        const steps = new Map();
        for (const line of log.split("\n")) {
            const [, step = "", rest = ""] = line.split("\t");
            const text = rest.replace(/^\S+Z /, "").replace(/(?:\x1b|\^\[)\[[0-9;]*m/g, "");
            if (!steps.has(step)) steps.set(step, []);
            steps.get(step).push(text);
        }
        console.log(`\n══ ${job.name}: ${job.conclusion} — лог целиком: ${path.relative(repoRoot, logPath)}`);
        for (const [step, lines] of steps) {
            if (!lines.some((l) => l.startsWith("##[error]"))) continue;
            console.log(`── ${step} (последние ${Math.min(tail, lines.length)} из ${lines.length} строк) ──`);
            console.log(lines.slice(-tail).join("\n"));
        }
    }
}
process.exit(ok ? 0 : 1);
