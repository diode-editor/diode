#!/usr/bin/env node
/**
 * Мутационное тестирование кода, который тронула задача: выжившие мутанты —
 * дырки в её тестах, которых покрытие не видит.
 *
 * В StrykerJS НЕТ `--since` (это опция Stryker.NET), так что diff-скоуп считаем
 * сами и отдаём флагом `--mutate`: новый файл — целиком, правленый — по строкам
 * хунков (`src/a.ts:120-160`). Пустой скоуп — выход нулём.
 *
 * Использование: npm run test:mutation [-- --base <ref>] [-- <доп. флаги Stryker'а>]
 * База по умолчанию — merge-base со свежим `origin/main` (сам делает fetch; не
 * вышло — что есть, затем локальный `main`).
 *
 * Свои флаги (остальные уезжают Stryker'у):
 *   --base <ref>    база диффа. Позиционный аргумент — ошибка: раньше он молча
 *                   уезжал Stryker'у как имя конфига;
 *   --scope-only    напечатать скоуп и выйти;
 *   --incremental   инкрементальный Stryker (reports/stryker-incremental.json);
 *                   переиспользованный «выживший» всё равно перепроверяется.
 *                   Полный пересчёт — `-- --incremental --force`;
 *   --verify-jobs N        песочниц перепроверки (по умолчанию 1: vitest и так
 *                          занимает все ядра);
 *   --verify-full          третий этап — весь сьют для не убитых узкими прогонами;
 *   --verify-timeout <с>   таймаут прогона vitest (по умолчанию 120 с + 3 с на файл);
 *   --verify-budget <мин>  бюджет перепроверки: не успевшие — inconclusive.
 *
 * Не убитых Stryker'ом перепроверяет вживлением `scripts/verify-mutants.mjs`;
 * классы — в `reports/mutation/verdict.json`. Исход — в `reports/mutation/gate.json`
 * (`outcome: empty-scope | passed | failed | error`); нет файла — скрипт упал.
 * По одному отсутствию `mutation.json` «нечего мутировать» от «сломалось» не
 * отличить: ночной прогон так три недели зеленел, ничего не проверяя.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { filterReportToScope, parseArgs, parseScope, scoreReport } from "./mutation-gate.mjs";
import { blockingVerdicts, countClasses, isCandidate, mergeVerdicts } from "./mutation-inject.mjs";
import { formatSummary, verifyMutants, writeVerdictFile } from "./verify-mutants.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");

const SOURCE_ROOTS = ["src/", "extensions/"];

const EXCLUDED = [
    /\.test\.ts$/,
    /\.bench\.ts$/,
    /\.stories\.ts$/,
    /\.d\.ts$/,
    /^src\/demos\//,
    /^src\/StoryRunner\//,
    /\/__fixtures__\//,
    // Выжившего не убить иначе как правкой генератора.
    /\.generated\.ts$/,
    // Выживший в фейке значит «этой возможностью никто не пользуется», а не дыру в тестах.
    /^src\/TestUtils\//,
    // Тестовый хелпер рядом с прод-модулями: его мутант убивается только тестом про тест.
    /^src\/vs\/diode\/modules\/testProfile\.ts$/,
    // Мутантов ноль, но файл читает КАК ТЕКСТ `builtinActions.when.test.ts`, а
    // инструментатор Stryker его перепечатывает — разбор по отступу ломается.
    /^src\/vs\/platform\/contextkey\/common\/contextKeys\.ts$/,
    // Дословный перенос upstream: правится только scripts/import-vscode-editor.mjs.
    /^src\/vs\/editor\/common\/diff\//,
    /^src\/vs\/base\/common\/(charCode|stopwatch)\.ts$/,
    /^src\/vs\/editor\/common\/model\/(textModelTokens|fixedArray)\.ts$/,
    /^src\/vs\/editor\/common\/core\/misc\/eolCounter\.ts$/,
    /^src\/vs\/editor\/common\/encodedTokenAttributes\.ts$/,
    /^src\/vs\/editor\/common\/tokens\/(lineTokens|contiguousMultilineTokens|contiguousMultilineTokensBuilder|contiguousTokensEditing)\.ts$/,
    /^src\/vs\/editor\/common\/languages\/nullTokenize\.ts$/,
    /^src\/vs\/editor\/common\/model\/pieceTreeTextBuffer\//,
    /^src\/vs\/editor\/common\/model\/textModelSearch\.ts$/,
    /^src\/vs\/editor\/common\/core\/(textChange|wordCharacterClassifier|characterClassifier)\.ts$/,
    /^src\/vs\/base\/common\/uint\.ts$/,
    // Тестовые шимы по путям upstream — те же тестовые хелперы, что src/TestUtils/.
    /^src\/vs\/editor\/test\/common\/testTextModel\.ts$/,
    /^src\/vs\/base\/test\//,
    // Процессный барьер: исполняется в дочернем процессе ext host'а, куда
    // `globalThis.__stryker__` не проходит, — все мутанты «не покрыты», убить их
    // нельзя. Ограничение инструмента, а не «не проверяем»: интеграционные тесты
    // есть. Снять — только пробросив активного мутанта и покрытие через процесс.
    /^extensions\/[^/]+\/main\.ts$/,
    // Тот же процессный барьер; гоняют интеграционные сьюты с настоящим субпроцессом.
    /^src\/vs\/workbench\/services\/extensions\/node\/extensionHostSubprocess\.ts$/,
    // Тот же барьер: только в форке бинаря (DIODE_RUN_AS_NODE), гейты — child-process.
    /^src\/vs\/diode\/runAsNode(\.testEntry)?\.ts$/,
    // Тот же барьер: только в форке (DIODE_FILE_WATCHER), гейт — treeWatcherMain.integration.test.ts и e2e.
    /^src\/vs\/platform\/files\/node\/treeWatcherMain(\.testEntry)?\.ts$/,
    // Исключён из покрытия, проверяется e2e против бинаря; мутируемая логика — в модулях, которые он склеивает.
    /^src\/vs\/diode\/main\.ts$/,
    // Тот же процессный барьер: входы ленивых кусков ролей, гейт — e2e на SEA-бинаре.
    /^src\/vs\/diode\/roles\/[^/]+\.ts$/,
    /^extensions\/[^/]+\/out\//,
];

function git(args) {
    // Без этого разбор diff'а зависит от ~/.gitconfig запускающего.
    const result = spawnSync("git", ["-c", "core.quotepath=false", "--no-pager", ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        // Дефолт 1 МБ, а дифф ночного окна — 11.7 МБ: переполнение убивает git
        // SIGTERM'ом (ENOBUFS) с пустым stderr, ночной прогон падал молча.
        maxBuffer: 1024 * 1024 * 1024,
    });
    if (result.status !== 0) {
        const why = result.error ? `${result.error.message}${result.signal ? ` (${result.signal})` : ""}` : result.stderr;
        throw new Error(`git ${args.join(" ")} упал:\n${why}`);
    }
    return result.stdout;
}

function isMutable(file) {
    if (!SOURCE_ROOTS.some((root) => file.startsWith(root))) return false;
    if (!file.endsWith(".ts")) return false;
    return !EXCLUDED.some((pattern) => pattern.test(file));
}

/**
 * `--no-prefix`, а не парсинг `+++ b/…`: при `diff.mnemonicPrefix` git печатает
 * `+++ w/…`, скоуп выходит пустым — и гейт молча зеленеет.
 */
function parseDiff(diff) {
    const scope = new Map();
    // Считает и файлы без мутируемых строк: по нему «сломан парсер» отличается от «дифф из одних удалений».
    let headers = 0;
    let current = null;
    let prevWasOldFileHeader = false;

    for (const line of diff.split("\n")) {
        // Только сразу после `---`: добавленная строка `++ x` в диффе выглядит как `+++ x`.
        if (prevWasOldFileHeader && line.startsWith("+++ ")) {
            const file = line.slice(4);
            headers++;
            current = file === "/dev/null" ? null : file;
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
        if (count === 0) continue;

        if (!scope.has(current)) scope.set(current, []);
        scope.get(current).push([start, start + count - 1]);
    }
    return { scope, headers };
}

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

const REPORT_DIR = path.join(repoRoot, "reports", "mutation");
const REPORT_PATH = path.join(REPORT_DIR, "mutation.json");
const GATE_PATH = path.join(REPORT_DIR, "gate.json");

// Первым делом: упади скрипт ниже, workflow прочёл бы старый файл как исход этого прогона.
rmSync(GATE_PATH, { force: true });

let args;
try {
    args = parseArgs(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exit(2);
}
const { scopeOnly, strykerArgs } = args;

/** Свежий `origin/main`: локальный `main` долгоживущего чекаута тащит в скоуп чужие влитые PR. */
function resolveBase(explicit) {
    if (explicit !== null) return { base: explicit, mergeBase: git(["merge-base", explicit, "HEAD"]).trim() };
    const fetch = spawnSync("git", ["fetch", "origin", "main", "--quiet"], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (fetch.status !== 0) console.warn("Не удалось обновить origin/main — беру то, что есть локально.");
    for (const candidate of ["origin/main", "main"]) {
        const result = spawnSync("git", ["merge-base", candidate, "HEAD"], { cwd: repoRoot, encoding: "utf8" });
        if (result.status === 0) return { base: candidate, mergeBase: result.stdout.trim() };
    }
    throw new Error("Не нашлось ни origin/main, ни main — задай базу явно: --base <ref>");
}

const { base, mergeBase } = resolveBase(args.base);
console.log(`База: ${base} → merge-base ${git(["log", "-1", "--format=%h %s", mergeBase]).trim()}`);

function finish(outcome, code, extra = {}) {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(GATE_PATH, JSON.stringify({ outcome, base, mergeBase, ...extra }, null, 2));
    process.exit(code);
}

const added = new Set(
    git(["diff", "--name-only", "--diff-filter=A", mergeBase, "--"])
        .split("\n")
        .filter(Boolean),
);

// Не добавленные в индекс файлы в diff не попадают, а в песочницу Stryker'а копируются.
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
    ...SOURCE_ROOTS,
]);
const { scope, headers } = parseDiff(diff);

if (diff.trim() !== "" && headers === 0) {
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
    if (!scopeOnly) finish("empty-scope", 0);
    process.exit(0);
}

console.log(`Скоуп мутаций (${mutate.length} записей против ${base}):`);
for (const entry of mutate) console.log(`  ${entry}`);

if (scopeOnly) process.exit(0);

const mutateScope = parseScope(mutate);

/**
 * Linux режет один аргумент на 128 КиБ (MAX_ARG_STRLEN), а `--mutate` ночного окна —
 * 196 КБ (E2BIG): большой скоуп уходит копией stryker.config.json. Пути в ней
 * Stryker резолвит от cwd, так что класть можно куда угодно.
 */
const MUTATE_ARG_LIMIT = 100_000;
const SCOPE_CONFIG_PATH = path.join(repoRoot, "reports", "stryker.scope.json");

function runStryker(scope, extraArgs = []) {
    let target = ["--mutate", scope.join(",")];
    if (target[1].length > MUTATE_ARG_LIMIT) {
        const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
        mkdirSync(path.dirname(SCOPE_CONFIG_PATH), { recursive: true });
        writeFileSync(SCOPE_CONFIG_PATH, JSON.stringify({ ...config, mutate: scope }, null, 2));
        target = [path.relative(repoRoot, SCOPE_CONFIG_PATH)];
    }
    return spawnSync("npx", ["stryker", "run", ...target, ...extraArgs, ...strykerArgs], {
        cwd: repoRoot,
        stdio: "inherit",
    });
}

function readReport() {
    if (!existsSync(REPORT_PATH)) return null;
    return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
}

function breakThreshold() {
    const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
    return config.thresholds?.break ?? null;
}

/**
 * По итоговому отчёту, а не по коду возврата Stryker'а: инкрементальный Stryker
 * считает в балл и старых мутантов вне `--mutate`. Классы без вердикта красят
 * гейт сами — балл их не видит, а «не смогли проверить» — не «проверено».
 */
function verdict(report, verdicts = []) {
    const threshold = breakThreshold();
    const { score } = scoreReport(report);
    const blocking = blockingVerdicts(verdicts);
    const passed = (threshold === null || score >= threshold) && blocking.length === 0;
    console.log(`\nМутационный балл по скоупу: ${score.toFixed(2)}% (порог ${String(threshold)}).`);
    if (blocking.length > 0) {
        console.log(
            `Без вердикта ${String(blocking.length)} мутантов (${formatSummary(blocking)}) — гейт красный, ` +
                "пока их не разберут (docs/MUTATION.md).",
        );
    }
    finish(passed ? "passed" : "failed", passed ? 0 : 1, {
        score,
        threshold,
        classes: countClasses(verdicts),
        blocking: blocking.map(({ file, line, mutatorName, class: cls, reason }) => ({
            file,
            line,
            mutatorName,
            class: cls,
            reason: reason.split("\n")[0],
        })),
    });
}

/**
 * Старый отчёт убирается ДО запуска: Stryker пишет его в самом конце, и умерший
 * раньше прогон (initial test run гоняет весь сьют — штатный случай) оставил бы
 * гейту чужих мутантов (#339).
 */
function runFresh(scope, extraArgs = []) {
    rmSync(REPORT_PATH, { force: true });
    const startedAt = Date.now();
    const { status } = runStryker(scope, extraArgs);
    if (!existsSync(REPORT_PATH)) return { status, report: null };
    // Секундный люфт — на грубое mtime некоторых ФС.
    if (statSync(REPORT_PATH).mtimeMs < startedAt - 1000) {
        throw new Error(`${REPORT_PATH} старше запуска Stryker'а — это отчёт чужого прогона.`);
    }
    return { status, report: readReport() };
}

const first = runFresh(mutate);
if (first.report === null) {
    console.error(
        `\nStryker не оставил отчёта (код ${String(first.status ?? "—")}) — вердикта нет. ` +
            "Смотри его вывод выше: чаще всего это падение initial test run.",
    );
    finish("error", 1, { reason: "первый прогон Stryker'а не оставил отчёта" });
}

const firstReport = first.report;
const dropped = filterReportToScope(firstReport, mutateScope);
if (dropped > 0) {
    console.log(
        `\nИз отчёта выброшено ${String(dropped)} мутантов вне скоупа — старые результаты ` +
            "инкрементального режима (прошлые ветки, код до ребейза).",
    );
}
// Сразу на диск: из него собираются комментарий в PR и тикет, даже если дальше что-то упадёт.
writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
// Не второй прогон Stryker'а построчным скоупом: тот не лечил промах подбора
// тестов (`vitest.related`, perTest-покрытие) и сам флакал (#339).
const candidates = Object.values(firstReport.files ?? {}).flatMap((data) => (data.mutants ?? []).filter(isCandidate));
if (candidates.length === 0) verdict(firstReport);

console.log(
    `\nНе убито Stryker'ом: ${String(candidates.length)}. Перепроверяю каждого вживлением точного мутанта ` +
        "(фантом / настоящий / без вердикта — см. docs/MUTATION.md):",
);
let verdicts = [];
try {
    verdicts = await verifyMutants({ root: repoRoot, report: firstReport, ...args.verify });
} catch (error) {
    console.error(`\nПерепроверка упала: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    finish("error", 1, { reason: "перепроверка вживлением упала" });
}
mergeVerdicts(firstReport, verdicts);
writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
writeVerdictFile(REPORT_DIR, verdicts);
console.log(`\nПерепроверено вживлением: ${formatSummary(verdicts)}.`);
verdict(firstReport, verdicts);
