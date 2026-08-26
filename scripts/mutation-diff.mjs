#!/usr/bin/env node
/**
 * Мутационное тестирование того кода, который тронула задача.
 *
 * Stryker мутирует ИСХОДНИКИ, а не тесты, поэтому «прогнать новые тесты через
 * Stryker» означает: мутировать код, который задача написала или правила, и
 * смотреть на выживших — это и есть дырки в новых тестах (тест без ассерта,
 * ассерт не туда — то, чего покрытие не видит принципиально).
 *
 * В StrykerJS НЕТ `--since` (это опция Stryker.NET, их постоянно путают), так
 * что diff-скоуп считаем сами и отдаём флагом `--mutate`:
 *   - новый файл  → `src/a.ts` целиком;
 *   - правленый   → `src/a.ts:120-160` по строкам из хунков diff'а.
 * Легаси-долг в старых файлах при этом не всплывает.
 *
 * Пустой скоуп — не падение: выходим нулём с внятным сообщением.
 *
 * Использование: npm run test:mutation [-- <база>] [-- <доп. флаги стрykerа>]
 * По умолчанию база — merge-base с `main`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Мутируем только продуктовый код этих корней; тесты, e2e, скрипты и конфиги — нет.
const SOURCE_ROOTS = ["src/", "extensions/"];

const EXCLUDED = [
    /\.test\.ts$/,
    /\.bench\.ts$/,
    /\.stories\.ts$/,
    /\.d\.ts$/,
    /^src\/demos\//,
    /^src\/StoryRunner\//,
    /\/__fixtures__\//,
    // Генерируемые файлы: выжившего мутанта там не убить иначе как правкой
    // генератора, так что находка нечинибельна по определению.
    /\.generated\.ts$/,
    // Тестовые хелперы и фейки. Выживший мутант в фейке означает «этой его
    // возможностью никто не пользуется», а не дыру в тестах продукта.
    /^src\/TestUtils\//,
    // Дословный перенос upstream vscode: не наш код, правится только пином
    // (scripts/import-vscode-diff.mjs). См. AGENTS.md.
    /^src\/vs\/editor\/common\/diff\//,
    /^src\/vs\/base\/common\/charCode\.ts$/,
    // Точка входа расширения. Её путь отдают extension host'у, а тот запускает
    // ОТДЕЛЬНЫЙ процесс — `globalThis.__stryker__` через границу процесса не
    // проходит, поэтому активный мутант в дочернем процессе не включается, а его
    // покрытие не возвращается. Все мутанты выходят «не покрыты ни одним тестом»
    // и убить их нельзя никаким тестом. Это ограничение инструмента, а не решение
    // «этот код не проверяем»: интеграционные тесты у расширений как раз есть
    // (extensions/git/git.integration.test.ts). Снять исключение можно, только
    // пробросив активного мутанта в дочерний процесс и вернув покрытие обратно.
    /^extensions\/[^/]+\/main\.ts$/,
    // Собранные артефакты расширений.
    /^extensions\/[^/]+\/out\//,
];

function git(args) {
    // Гасим пользовательские настройки, которые меняют формат вывода: без этого
    // разбор diff'а зависит от ~/.gitconfig того, кто запускает.
    const result = spawnSync(
        "git",
        ["-c", "core.quotepath=false", "--no-pager", ...args],
        { cwd: repoRoot, encoding: "utf8" },
    );
    if (result.status !== 0) {
        throw new Error(`git ${args.join(" ")} упал:\n${result.stderr}`);
    }
    return result.stdout;
}

function isMutable(file) {
    if (!SOURCE_ROOTS.some((root) => file.startsWith(root))) return false;
    if (!file.endsWith(".ts")) return false;
    return !EXCLUDED.some((pattern) => pattern.test(file));
}

/**
 * Разбирает `git diff -U0 --no-prefix` в карту «файл → диапазоны строк новой версии».
 *
 * Именно `--no-prefix`, а не парсинг `+++ b/…`: у пользователя может быть включён
 * `diff.mnemonicPrefix`, и тогда git печатает `+++ w/…`. Регулярка на `b/` в этом
 * случае не находит ни одного файла, скоуп выходит пустым — и гейт молча проходит,
 * не проверив ничего. Тихо-зелёный гейт хуже отсутствующего.
 */
function parseDiff(diff) {
    const scope = new Map();
    let current = null;
    let prevWasOldFileHeader = false;

    for (const line of diff.split("\n")) {
        // `+++` считаем заголовком только сразу после `---`: добавленная строка
        // исходника `++ x` в диффе выглядит как `+++ x` и иначе сошла бы за имя файла.
        if (prevWasOldFileHeader && line.startsWith("+++ ")) {
            const file = line.slice(4);
            current = file === "/dev/null" ? null : file; // удалённый файл мутировать нечего
            prevWasOldFileHeader = false;
            continue;
        }
        prevWasOldFileHeader = line.startsWith("--- ");
        if (prevWasOldFileHeader) continue;
        if (!current) continue;

        const hunkMatch = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!hunkMatch) continue;

        const start = Number(hunkMatch[1]);
        const count = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
        if (count === 0) continue; // чистое удаление строк — мутировать нечего

        if (!scope.has(current)) scope.set(current, []);
        scope.get(current).push([start, start + count - 1]);
    }
    return scope;
}

/** Склеивает соседние и пересекающиеся диапазоны, чтобы не плодить аргументы. */
function mergeRanges(ranges) {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [start, end] of sorted) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1] + 1) {
            last[1] = Math.max(last[1], end);
        } else {
            merged.push([start, end]);
        }
    }
    return merged;
}

const argv = process.argv.slice(2);
// `--scope-only` печатает скоуп и выходит: прогон на широко импортируемом файле
// стоит десятки минут, и перед ним полезно увидеть, что именно будет мутировано.
const scopeOnly = argv.includes("--scope-only");
const rest = argv.filter((arg) => arg !== "--scope-only");
// База — только первый позиционный аргумент; всё, что начинается с дефиса,
// уходит стрykerу, иначе `-- --concurrency 4` было бы понято как имя ревизии.
const base = rest[0] !== undefined && !rest[0].startsWith("-") ? rest.shift() : "main";
const strykerArgs = rest;

const mergeBase = git(["merge-base", base, "HEAD"]).trim();

// Новые файлы мутируем целиком: у них весь текст — новый код.
const added = new Set(
    git(["diff", "--name-only", "--diff-filter=A", mergeBase, "--"])
        .split("\n")
        .filter(Boolean),
);

// Ещё не добавленные в индекс файлы в diff не попадают вообще, а в sandbox
// Stryker'а копируются и работают — без этого свежий файл молча ускользнул бы
// от гейта.
const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
for (const file of untracked) added.add(file);

const diff = git([
    "diff",
    "-U0",
    "--no-prefix",
    "--no-color",
    "--no-ext-diff",
    mergeBase,
    "--",
]);
const scope = parseDiff(diff);

// Защита от тихо-зелёного гейта: если git что-то выдал, а разобрать не удалось
// ни одного файла — сломан парсер, а не пуст дифф. Падаем громко.
if (diff.trim() !== "" && scope.size === 0) {
    throw new Error(
        "Не удалось разобрать вывод git diff — ни одного файла не распознано, " +
            "хотя дифф не пуст. Скоуп мутаций был бы пуст, и гейт прошёл бы, ничего не проверив.",
    );
}

for (const file of untracked) if (!scope.has(file)) scope.set(file, []);

const mutate = [];
for (const [file, ranges] of scope) {
    if (!isMutable(file)) continue;
    if (added.has(file)) {
        mutate.push(file);
        continue;
    }
    for (const [start, end] of mergeRanges(ranges)) {
        mutate.push(`${file}:${start}-${end}`);
    }
}

if (mutate.length === 0) {
    console.log(
        `Мутировать нечего: в диффе против ${base} (${mergeBase.slice(0, 8)}) нет ` +
            `изменений в продуктовом коде src//extensions/.`,
    );
    process.exit(0);
}

console.log(`Скоуп мутаций (${mutate.length} записей против ${base}):`);
for (const entry of mutate) console.log(`  ${entry}`);

if (scopeOnly) process.exit(0);

function runStryker(scope) {
    return spawnSync("npx", ["stryker", "run", "--mutate", scope.join(","), ...strykerArgs], {
        cwd: repoRoot,
        stdio: "inherit",
    });
}

/**
 * Выжившие из отчёта, разложенные по тому, проверяли их вообще или нет.
 *
 * `testsCompleted: 0` у выжившего означает, что при его прогоне не выполнилось
 * НИ ОДНОГО теста — хотя покрывающих у мутанта могут быть сотни. Это дефект
 * связки Stryker↔vitest (наблюдается и с `perTest`, и с `coverageAnalysis:
 * off`, и с перезапуском раннера), а не дыра в тестах: тот же мутант в
 * точечном прогоне уверенно убивается. Такого выжившего считать находкой
 * нельзя — «ничего не запускали» это не «никто не заметил».
 */
const REPORT_PATH = path.join(repoRoot, "reports", "mutation", "mutation.json");

function readReport() {
    if (!existsSync(REPORT_PATH)) return null;
    return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
}

/** Ключ мутанта: файл + позиция + мутатор — так он сходится между прогонами. */
function mutantKey(file, mutant) {
    return `${file}:${String(mutant.location?.start?.line)}:${String(mutant.location?.start?.column)}:${String(mutant.mutatorName)}`;
}

/**
 * Возвращает отчёт первого прогона на место точечного: комментарий в PR должен
 * показывать всю картину, а не тот кусок, который перепроверяли. Мутанты,
 * убитые в перепроверке, получают статус `Killed` с причиной — почему их
 * пришлось гонять отдельно, видно прямо в отчёте.
 */
function mergeRecheckIntoReport(firstReport) {
    const recheckReport = readReport();
    if (firstReport === null || recheckReport === null) return 0;
    let rechecked = 0;
    const killedOnRecheck = new Set();
    for (const [file, data] of Object.entries(recheckReport.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            rechecked++;
            if (mutant.status === "Killed" || mutant.status === "Timeout") killedOnRecheck.add(mutantKey(file, mutant));
        }
    }
    for (const [file, data] of Object.entries(firstReport.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            if (mutant.status !== "Survived" || mutant.testsCompleted) continue;
            if (!killedOnRecheck.has(mutantKey(file, mutant))) continue;
            mutant.status = "Killed";
            mutant.statusReason = "перепроверен точечным прогоном: в общем прогоне не выполнилось ни одного теста";
        }
    }
    writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
    return rechecked;
}

function classifySurvivors() {
    const report = readReport();
    if (report === null) return null;
    const verified = [];
    const unverified = [];
    for (const [file, data] of Object.entries(report.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            if (mutant.status !== "Survived") continue;
            const start = mutant.location?.start?.line;
            if (start === undefined) continue;
            // Диапазон — по всей длине мутанта: у многострочных (вырезанное тело
            // функции) `--mutate file:N-N` не покрыл бы его целиком, и скоуп
            // вышел бы пустым — перепроверка молча ничего бы не проверила.
            const end = mutant.location?.end?.line ?? start;
            (mutant.testsCompleted ? verified : unverified).push({ file, start, end });
        }
    }
    return { verified, unverified };
}

const first = runStryker(mutate);
if ((first.status ?? 1) === 0) process.exit(0);

const survivors = classifySurvivors();
if (survivors === null || survivors.unverified.length === 0) {
    process.exit(first.status ?? 1);
}
if (survivors.verified.length > 0) {
    console.log(
        `Есть выжившие, проверенные тестами (${String(survivors.verified.length)}) — перепроверять нечего.`,
    );
    process.exit(first.status ?? 1);
}

// Перепроверяем точечно: скоуп в одну строку на мутанта прогоняется надёжно.
const recheck = [...new Set(survivors.unverified.map(({ file, start, end }) => `${file}:${start}-${end}`))];
console.log(
    `\nВыжившие (${String(survivors.unverified.length)}) прогнались с нулём выполненных тестов — это не находка, ` +
        `а известный дефект связки Stryker↔vitest (см. docs/TESTING.md). Перепроверяю точечно:`,
);
for (const entry of recheck) console.log(`  ${entry}`);

const firstReport = readReport();
const recheckStatus = runStryker(recheck).status ?? 1;
const rechecked = mergeRecheckIntoReport(firstReport);

// Пустая перепроверка — тихо-зелёный гейт: Stryker на скоупе без мутантов
// выходит нулём. Падаем громко, иначе «ничего не проверили» станет «всё хорошо».
if (rechecked === 0) {
    console.error(
        "Перепроверка не нашла ни одного мутанта в своём скоупе — гейт ничего не проверил. " +
            "Скорее всего разъехались диапазоны строк; чинить в scripts/mutation-diff.mjs.",
    );
    process.exit(1);
}

process.exit(recheckStatus);
