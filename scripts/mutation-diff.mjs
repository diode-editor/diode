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
 * Мутанты, которых прогон НЕ проверил. Их два вида, и ни один нельзя читать
 * как «тесты не заметили».
 *
 * `Survived` с `testsCompleted: 0` — при прогоне не выполнилось НИ ОДНОГО
 * теста, хотя покрывающих у мутанта могут быть сотни. Прогон теряется, и
 * теряется он ровно следом за прогоном, оборванным по bail (Stryker гоняет
 * vitest с `bail: 1`): файлы остаются в состоянии `run` без результатов, а
 * `vitest-test-runner` отбрасывает всё без результата и получает пустой список
 * тестов. Апстрим: stryker-mutator/stryker-js#6073, чинит #6146 (не влит).
 *
 * `RuntimeError` — на этом мутанте упал сам раннер. Такой мутант не попадает в
 * знаменатель балла, поэтому сам по себе гейт НЕ красит: Stryker выходит нулём,
 * и мутант уезжает непроверенным. Наш штатный источник — мутант, из-за которого
 * слушатель кидает асинхронно (в микротаске): ни один тест при этом не падает,
 * vitest записывает unhandled error, а `vitest-runner` ломается, пытаясь эту
 * ошибку сериализовать (`String()` над объектом, у которого собственный
 * `toString` — строка `"Function<toString>"`).
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

/** Непроверенный мутант — почему его пришлось гонять отдельно, видно прямо в отчёте. */
function recheckReason(status) {
    return status === "RuntimeError"
        ? "перепроверен точечным прогоном: в общем прогоне на нём упал раннер"
        : "перепроверен точечным прогоном: в общем прогоне не выполнилось ни одного теста";
}

/** Мутант, которого первый прогон не проверил: перепроверять — обязательно. */
function isUnchecked(mutant) {
    return mutant.status === "RuntimeError" || (mutant.status === "Survived" && !mutant.testsCompleted);
}

/**
 * Возвращает отчёт первого прогона на место точечного: комментарий в PR должен
 * показывать всю картину, а не тот кусок, который перепроверяли. Мутанты,
 * убитые в перепроверке, получают статус `Killed` с причиной.
 *
 * Отдельно возвращает тех, на ком раннер упал и в точечном прогоне: их не
 * проверил ни один из двух прогонов, и молчать об этом нельзя.
 */
function mergeRecheckIntoReport(firstReport) {
    const recheckReport = readReport();
    if (firstReport === null || recheckReport === null) return { rechecked: 0, stillCrashed: [] };
    let rechecked = 0;
    const stillCrashed = [];
    const killedOnRecheck = new Set();
    for (const [file, data] of Object.entries(recheckReport.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            rechecked++;
            if (mutant.status === "Killed" || mutant.status === "Timeout") killedOnRecheck.add(mutantKey(file, mutant));
            if (mutant.status === "RuntimeError") {
                stillCrashed.push({
                    at: `${file}:${String(mutant.location?.start?.line)} (${String(mutant.mutatorName)} → ${String(mutant.replacement)})`,
                    reason: String(mutant.statusReason ?? "").split("\n")[0],
                });
            }
        }
    }
    for (const [file, data] of Object.entries(firstReport.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            if (!isUnchecked(mutant)) continue;
            if (!killedOnRecheck.has(mutantKey(file, mutant))) continue;
            mutant.statusReason = recheckReason(mutant.status);
            mutant.status = "Killed";
        }
    }
    writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
    return { rechecked, stillCrashed };
}

function classifyMutants() {
    const report = readReport();
    if (report === null) return null;
    const verified = [];
    const unchecked = [];
    for (const [file, data] of Object.entries(report.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            const start = mutant.location?.start?.line;
            if (start === undefined) continue;
            // Диапазон — по всей длине мутанта: у многострочных (вырезанное тело
            // функции) `--mutate file:N-N` не покрыл бы его целиком, и скоуп
            // вышел бы пустым — перепроверка молча ничего бы не проверила.
            const end = mutant.location?.end?.line ?? start;
            if (isUnchecked(mutant)) unchecked.push({ file, start, end, status: mutant.status });
            else if (mutant.status === "Survived") verified.push({ file, start, end });
        }
    }
    return { verified, unchecked };
}

const first = runStryker(mutate);
const classified = classifyMutants();

// Ноль от Stryker'а — ещё не «всё проверено»: упавшие на раннере мутанты в балл
// не входят, так что прогон с ними выходит нулём. Смотрим не на код возврата, а
// на отчёт.
if (classified === null || classified.unchecked.length === 0) {
    process.exit(first.status ?? 1);
}
if (classified.verified.length > 0) {
    console.log(
        `Есть выжившие, проверенные тестами (${String(classified.verified.length)}) — перепроверять нечего.`,
    );
    process.exit(first.status ?? 1);
}

// Перепроверяем точечно: скоуп в одну строку на мутанта прогоняется надёжно.
const recheck = [...new Set(classified.unchecked.map(({ file, start, end }) => `${file}:${start}-${end}`))];
const lost = classified.unchecked.filter(({ status }) => status === "Survived").length;
const crashed = classified.unchecked.length - lost;
console.log(
    `\nНепроверенных мутантов: ${String(classified.unchecked.length)} ` +
        `(потерянных прогонов — ${String(lost)}, падений раннера — ${String(crashed)}). ` +
        `Ни то, ни другое не находка (см. docs/TESTING.md). Перепроверяю точечно:`,
);
for (const entry of recheck) console.log(`  ${entry}`);

const firstReport = readReport();
const recheckStatus = runStryker(recheck).status ?? 1;
const { rechecked, stillCrashed } = mergeRecheckIntoReport(firstReport);

// Пустая перепроверка — тихо-зелёный гейт: Stryker на скоупе без мутантов
// выходит нулём. Падаем громко, иначе «ничего не проверили» станет «всё хорошо».
if (rechecked === 0) {
    console.error(
        "Перепроверка не нашла ни одного мутанта в своём скоупе — гейт ничего не проверил. " +
            "Скорее всего разъехались диапазоны строк; чинить в scripts/mutation-diff.mjs.",
    );
    process.exit(1);
}

// Упал и в точечном прогоне — значит мутанта не проверил ни один из двух.
// Пропустить его молча нельзя: в балл он не входит и гейт бы позеленел.
if (stillCrashed.length > 0) {
    console.error("\nНа этих мутантах раннер падает и в точечном прогоне — их не проверил никто:");
    for (const { at, reason } of stillCrashed) console.error(`  ${at}\n    ${reason}`);
    console.error(
        "\nПочти всегда это наш код, а не инструмент: мутант заставляет слушателя кинуть " +
            "асинхронно, тест при этом не падает, и vitest ломается на сериализации unhandled " +
            "error. Разбор и что делать — docs/TESTING.md.",
    );
    process.exit(1);
}

process.exit(recheckStatus);
