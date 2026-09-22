#!/usr/bin/env node
/**
 * Ветка итерации и её журнал — вся git-механика офиса агентов в одном месте.
 *
 * Офис (`office.yaml`, движок @tihonove/agent-office) про git не знает: он двигает
 * узлы и раздаёт роли, а где живёт код — дело проекта. Итерация у нас — это ветка
 * `iteration/NN`, собранная из веток заявок, и журнал `docs/iterations/NN.md` на
 * этой же ветке. Журнал — источник правды о составе итерации: из него собирается
 * тело PR и по нему откатывается отозванная человеком заявка.
 *
 * Команды (их зовут роли «интегратор», «откатчик», «сборщик», «релизёр»):
 *
 *   node scripts/iteration.mjs current                    какая итерация открыта
 *   node scripts/iteration.mjs start [NN]                 открыть новую итерацию от ствола
 *   node scripts/iteration.mjs land <узел> <ветка> <текст> влить ветку заявки и записать в журнал
 *   node scripts/iteration.mjs revoke <узел> [причина]    снять заявку со сборки (revert влития)
 *   node scripts/iteration.mjs list [--json]              что сейчас в итерации
 *   node scripts/iteration.mjs summary                    тело PR по журналу
 *   node scripts/iteration.mjs verify                     lint + typecheck + test на ветке итерации
 *
 * Команды, меняющие ветку итерации, берут замок `.office/iteration.lock`:
 * интеграторов офис может поднять несколько сразу, а ветка одна. Работают они в
 * отдельном worktree `.claude/worktrees/iteration`, так что основное дерево (в нём
 * крутится сам офис и сидят агенты) не трогается никогда.
 *
 * Автор коммита — та роль, которая зовёт скрипт: офис кладёт её в переменную
 * окружения OFFICE_PLACE (`…/назначения/<роль>/<узел>`). Отсюда «коммиты от своего имени».
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

// Корень репозитория берём от самого скрипта: агенты зовут его из любого каталога.
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", cwd: import.meta.dirname }).trim();
const TRUNK = process.env.DIODE_TRUNK ?? "main";
const worktreeDir = path.join(repoRoot, ".claude", "worktrees", "iteration");
const lockDir = path.join(repoRoot, ".office", "iteration.lock");

// ── Запуск команд ───────────────────────────────────────────────────────────

function run(cmd, args, cwd = repoRoot) {
    return execFileSync(cmd, args, { encoding: "utf8", cwd, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const git = (args, cwd = repoRoot) => run("git", args, cwd);

/** Как git(), но код возврата — часть ответа: конфликт вливания это не падение скрипта, а его результат. */
function tryGit(args, cwd = repoRoot) {
    try {
        return { ok: true, out: git(args, cwd) };
    } catch (e) {
        return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() };
    }
}

function fail(message) {
    console.error(message);
    process.exit(2);
}

const readIfExists = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");

// ── Кто коммитит ────────────────────────────────────────────────────────────

/** Роль и узел из OFFICE_PLACE (`…/назначения/<роль>/<узел>`). Вне офиса — просто «офис». */
function whoAmI() {
    const place = process.env.OFFICE_PLACE;
    if (!place) {
        return { role: "офис", node: "" };
    }
    const parts = place.replace(/\/+$/, "").split("/");
    return { role: parts.at(-2) ?? "офис", node: parts.at(-1) ?? "" };
}

function signature() {
    const { role, node } = whoAmI();
    return ["-c", `user.name=${node ? `${role} ${node}` : role}`, "-c", "user.email=office@diode.local"];
}

// ── Замок на ветку итерации ─────────────────────────────────────────────────

/**
 * mkdir атомарен, поэтому второй интегратор честно ждёт первого. Протухший замок
 * (процесса, который его взял, уже нет) снимаем сами: иначе упавший агент запер бы
 * конвейер навсегда.
 */
async function underLock(work, waitMs = 10 * 60 * 1000) {
    const deadline = Date.now() + waitMs;
    mkdirSync(path.dirname(lockDir), { recursive: true });
    for (;;) {
        try {
            mkdirSync(lockDir, { recursive: false });
            const { role, node } = whoAmI();
            writeFileSync(path.join(lockDir, "owner"), `${process.pid}\n${role}/${node}\n`);
            break;
        } catch {
            if (lockIsStale()) {
                rmSync(lockDir, { recursive: true, force: true });
                continue;
            }
            if (Date.now() > deadline) {
                fail(`Замок ${lockDir} занят дольше ${Math.round(waitMs / 60000)} мин. Держит:\n${readIfExists(path.join(lockDir, "owner"))}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
    try {
        return await work();
    } finally {
        rmSync(lockDir, { recursive: true, force: true });
    }
}

function lockIsStale() {
    const pid = Number(readIfExists(path.join(lockDir, "owner")).split("\n")[0]);
    if (!pid) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return false;
    } catch {
        return true;
    }
}

// ── Ветка итерации и её рабочее дерево ──────────────────────────────────────

/** Открытая итерация — ветка `iteration/NN`, ещё не влитая в ствол. Такая должна быть одна. */
function openIteration() {
    const branches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads/iteration"])
        .split("\n")
        .filter(Boolean)
        .filter((branch) => !tryGit(["merge-base", "--is-ancestor", branch, TRUNK]).ok);
    if (branches.length > 1) {
        fail(`Открытых итераций несколько: ${branches.join(", ")}. Оставь одну — офис ведёт только текущую.`);
    }
    return branches[0] ?? null;
}

const numberOf = (branch) => branch.slice("iteration/".length);
const ledgerPath = (branch) => `docs/iterations/${numberOf(branch)}.md`;

/** Рабочее дерево ветки итерации. Заводим по требованию; основное дерево не трогаем. */
function iterationWorktree(branch) {
    if (!existsSync(worktreeDir)) {
        mkdirSync(path.dirname(worktreeDir), { recursive: true });
        git(["worktree", "add", worktreeDir, branch]);
    }
    if (git(["rev-parse", "--abbrev-ref", "HEAD"], worktreeDir) !== branch) {
        git(["checkout", branch], worktreeDir);
    }
    return worktreeDir;
}

// ── Журнал итерации ─────────────────────────────────────────────────────────

const ledgerHeader = (number) =>
    `# Итерация ${number}\n\n` +
    `Ветка \`iteration/${number}\`, ствол \`${TRUNK}\`. Журнал ведут роли офиса — руками его не правят.\n\n` +
    `| Узел | Заявка | Ветка | Влито | Статус |\n| --- | --- | --- | --- | --- |\n`;

/** Строки журнала → записи. Формат строки: `| n-7 | заголовок | \`task/n-7\` | \`sha\` | влито |`. */
function parseLedger(text) {
    return text
        .split("\n")
        .filter((line) => /^\|\s*n-\d+\s*\|/.test(line))
        .map((line) => {
            const [node, title, branch, merge, status] = line
                .split("|")
                .slice(1, -1)
                .map((cell) => cell.trim().replace(/^`|`$/g, ""));
            return { node, title, branch, merge, status, line };
        });
}

const toLedgerLine = ({ node, title, branch, merge, status }) => `| ${node} | ${title} | \`${branch}\` | \`${merge}\` | ${status} |`;

function readLedger(worktree, branch) {
    const file = path.join(worktree, ledgerPath(branch));
    const text = readIfExists(file);
    return { file, text: text || ledgerHeader(numberOf(branch)), entries: parseLedger(text) };
}

function commitLedger(worktree, branch, message) {
    git(["add", ledgerPath(branch)], worktree);
    git([...signature(), "commit", "-m", message], worktree);
}

// ── Команды ─────────────────────────────────────────────────────────────────

function current() {
    const branch = openIteration();
    if (!branch) {
        console.log("Открытой итерации нет. Открыть: node scripts/iteration.mjs start");
        process.exit(1);
    }
    const worktree = iterationWorktree(branch);
    const { entries } = readLedger(worktree, branch);
    const landed = entries.filter((entry) => entry.status === "влито").length;
    console.log(`номер: ${numberOf(branch)}`);
    console.log(`ветка: ${branch}`);
    console.log(`журнал: ${ledgerPath(branch)}`);
    console.log(`дерево: ${worktree}`);
    console.log(`в сборке заявок: ${landed} (отозвано ${entries.length - landed})`);
}

async function start(explicitNumber) {
    const open = openIteration();
    if (open) {
        fail(`Итерация ${numberOf(open)} ещё открыта — закрой её (сборка → приёмка → релиз), прежде чем открывать новую.`);
    }
    const previous = git(["for-each-ref", "--format=%(refname:short)", "refs/heads/iteration"]).split("\n").filter(Boolean);
    const next = String(Math.max(0, ...previous.map((branch) => Number(numberOf(branch)) || 0)) + 1).padStart(2, "0");
    const number = explicitNumber ?? next;
    const branch = `iteration/${number}`;

    await underLock(async () => {
        git(["branch", branch, TRUNK]);
        const worktree = iterationWorktree(branch);
        const { file, text } = readLedger(worktree, branch);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, text);
        commitLedger(worktree, branch, `chore(iteration): открыта итерация ${number}`);
    });
    console.log(`Итерация ${number} открыта: ветка ${branch} от ${TRUNK}.`);
    return branch;
}

async function land(node, taskBranch, title) {
    if (!node || !taskBranch || !title) {
        fail("Зову так: node scripts/iteration.mjs land <узел> <ветка> <заголовок одной строкой>");
    }
    const branch = openIteration() ?? (await start());
    await underLock(async () => {
        const worktree = iterationWorktree(branch);
        const merge = tryGit([...signature(), "merge", "--no-ff", taskBranch, "-m", `${node}: ${title}`], worktree);
        if (!merge.ok) {
            const conflicts = tryGit(["diff", "--name-only", "--diff-filter=U"], worktree).out;
            tryGit(["merge", "--abort"], worktree);
            fail(`Не влилось — конфликт с тем, что уже в итерации.\nФайлы:\n${conflicts}\n\n${merge.out}`);
        }
        const sha = git(["rev-parse", "--short", "HEAD"], worktree);

        const { file, text, entries } = readLedger(worktree, branch);
        const entry = { node, title, branch: taskBranch, merge: sha, status: "влито" };
        const previous = entries.find((candidate) => candidate.node === node);
        writeFileSync(file, previous ? text.replace(previous.line, toLedgerLine(entry)) : `${text.trimEnd()}\n${toLedgerLine(entry)}\n`);
        commitLedger(worktree, branch, `chore(iteration): ${node} в итерации ${numberOf(branch)}`);
        console.log(`Влито в ${branch}: ${node} (${taskBranch}) → ${sha}`);
    });
}

async function revoke(node, reason) {
    const branch = openIteration();
    if (!branch) {
        fail("Открытой итерации нет — отзывать не из чего.");
    }
    await underLock(async () => {
        const worktree = iterationWorktree(branch);
        const { file, text, entries } = readLedger(worktree, branch);
        const entry = entries.find((candidate) => candidate.node === node);
        if (!entry) {
            fail(`В журнале итерации ${numberOf(branch)} нет заявки ${node}.`);
        }
        if (entry.status !== "влито") {
            console.log(`${node} уже не в сборке (${entry.status}) — ничего не делаю.`);
            return;
        }

        const revert = tryGit([...signature(), "revert", "-m", "1", "--no-edit", entry.merge], worktree);
        if (!revert.ok) {
            const conflicts = tryGit(["diff", "--name-only", "--diff-filter=U"], worktree).out;
            tryGit(["revert", "--abort"], worktree);
            fail(`Откат не получился: поверх ${node} уже легла другая работа.\nФайлы:\n${conflicts}\n\n${revert.out}`);
        }
        git([...signature(), "commit", "--amend", "-m", `revert(iteration): ${node} снята со сборки${reason ? ` — ${reason}` : ""}`], worktree);

        writeFileSync(file, text.replace(entry.line, toLedgerLine({ ...entry, status: "отозвано" })));
        commitLedger(worktree, branch, `chore(iteration): ${node} снята с итерации ${numberOf(branch)}`);
        console.log(
            `Снято с ${branch}: ${node}.\n` +
                `Важно: доработку реализатор ведёт в НОВОЙ ветке (${entry.branch}-2) — повторное вливание старой ничего не вернёт (git помнит revert).`,
        );
    });
}

function list(asJson) {
    const branch = openIteration();
    if (!branch) {
        fail("Открытой итерации нет.");
    }
    const { entries } = readLedger(iterationWorktree(branch), branch);
    if (asJson) {
        console.log(JSON.stringify({ number: numberOf(branch), branch, entries: entries.map(({ line, ...rest }) => rest) }, null, 2));
        return;
    }
    for (const entry of entries) {
        console.log(`${entry.status === "влито" ? "+" : "-"} ${entry.node} · ${entry.title} · ${entry.branch} · ${entry.merge} · ${entry.status}`);
    }
}

function summary() {
    const branch = openIteration();
    if (!branch) {
        fail("Открытой итерации нет.");
    }
    const { entries } = readLedger(iterationWorktree(branch), branch);
    const landed = entries.filter((entry) => entry.status === "влито");
    const revoked = entries.filter((entry) => entry.status !== "влито");

    const lines = [
        `## Что в итерации ${numberOf(branch)}`,
        "",
        ...(landed.length
            ? ["| Заявка | Узел | Ветка |", "| --- | --- | --- |", ...landed.map((e) => `| ${e.title} | ${e.node} | \`${e.branch}\` |`)]
            : ["_Пусто: в итерацию ничего не влито._"]),
    ];
    if (revoked.length) {
        lines.push("", "## Снято со сборки", "", ...revoked.map((e) => `- ${e.node} · ${e.title} — человек вернул, ушло на доработку`));
    }
    console.log(lines.join("\n"));
}

function verify() {
    const branch = openIteration();
    if (!branch) {
        fail("Открытой итерации нет.");
    }
    const worktree = iterationWorktree(branch);
    if (!existsSync(path.join(worktree, "node_modules"))) {
        console.log("Ставлю зависимости в дереве итерации (первый раз это долго)…");
        execFileSync("npm", ["ci"], { cwd: worktree, stdio: "inherit" });
    }
    for (const task of ["lint", "typecheck", "test"]) {
        console.log(`\n── npm run ${task} на ${branch} ──`);
        execFileSync("npm", ["run", task], { cwd: worktree, stdio: "inherit" });
    }
    console.log(`\nЗелено: ${branch} собирается и проходит тесты.`);
}

// ── Разбор аргументов ───────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

switch (command) {
    case "current":
        current();
        break;
    case "start":
        await start(args[0]);
        break;
    case "land":
        await land(args[0], args[1], args.slice(2).join(" "));
        break;
    case "revoke":
        await revoke(args[0], args.slice(1).join(" "));
        break;
    case "list":
        list(args.includes("--json"));
        break;
    case "summary":
        summary();
        break;
    case "verify":
        verify();
        break;
    default:
        fail(
            "node scripts/iteration.mjs <команда>\n\n" +
                "  current                        какая итерация открыта\n" +
                "  start [NN]                     открыть новую итерацию от ствола\n" +
                "  land <узел> <ветка> <текст>    влить ветку заявки и записать её в журнал\n" +
                "  revoke <узел> [причина]        снять заявку со сборки\n" +
                "  list [--json]                  что сейчас в итерации\n" +
                "  summary                        тело PR по журналу\n" +
                "  verify                         lint + typecheck + test на ветке итерации",
        );
}
