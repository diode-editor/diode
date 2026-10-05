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
 * Использование: npm run test:mutation [-- --base <ref>] [-- <доп. флаги Stryker'а>]
 * По умолчанию база — merge-base со свежим `origin/main` (скрипт сам делает
 * `git fetch origin main`; не вышло — берёт что есть, затем локальный `main`).
 * Какая база взята и её SHA — печатается в начале прогона.
 *
 * Флаги, которые скрипт понимает сам (остальные уезжают Stryker'у как есть):
 *   --base <ref>    база диффа. Позиционный аргумент — ошибка: раньше база была
 *                   первым позиционным, и `npm run test:mutation -- X` молча
 *                   брал `main`, отдавая `X` Stryker'у как имя конфига;
 *   --scope-only    напечатать скоуп и выйти;
 *   --incremental   инкрементальный режим Stryker'а: результаты прошлого прогона
 *                   лежат в reports/stryker-incremental.json, и мутант, у которого не
 *                   менялись ни код, ни убивший его тест, заново не гоняется. Повтор на
 *                   неизменном коде — секунды вместо минут (замер — TODO/TestRunTime.md).
 *                   Перепроверка выживших в этом режиме идёт с `--force`: иначе Stryker
 *                   переиспользовал бы и того «выжившего», которого надо перепроверить.
 *                   Полный пересчёт без переиспользования — `-- --incremental --force`.
 *
 * Исход прогона скрипт пишет в `reports/mutation/gate.json`
 * (`{ outcome: "empty-scope" | "passed" | "failed" | "error", … }`). Нет файла —
 * скрипт упал, не дойдя до вердикта. По нему workflow'ы отличают «мутировать
 * нечего» от «прогон сломался»: по одному отсутствию `mutation.json` это не
 * различить, и ночной прогон три недели зеленел, ничего не проверяя.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { filterReportToScope, inScope, mutantKey, parseArgs, parseScope, scoreReport } from "./mutation-gate.mjs";

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
    // Тестовый профиль DI — тот же тестовый хелпер, просто живёт рядом с
    // продовыми модулями. Он не поведение приложения, а сборка контейнера ДЛЯ
    // тестов: мутант в нём («другой временный каталог», «пустой host») убивается
    // только ассертом на саму проводку тестов, то есть тестом про тест. Прод-модули
    // рядом мутируются как обычно — их проверяет `extensionsModule.test.ts`.
    /^src\/vs\/diode\/modules\/testProfile\.ts$/,
    // Объявления контекст-ключей — чистые типы: мутантов там ноль, зато файл
    // читает КАК ТЕКСТ гейт `builtinActions.when.test.ts` (источник правды об
    // объявленных ключах — сам интерфейс). В песочнице Stryker файл из скоупа
    // перепечатывается инструментатором, разбор по отступу ломается, и дырой
    // в тестах это не является — это границы инструмента.
    /^src\/vs\/platform\/contextkey\/common\/contextKeys\.ts$/,
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
    // Тот же процессный барьер с другой стороны: entry субпроцесса extension
    // host'а и его RPC-хелперы исполняются ТОЛЬКО в дочернем процессе
    // (spawn из ExtensionHost), `globalThis.__stryker__` туда не проходит —
    // все мутанты выходят «не покрыты». Поведение файла гоняют интеграционные
    // сьюты с настоящим субпроцессом (extensionHost.context/fork/pythonLsp*),
    // из покрытия vitest он исключён по той же причине.
    /^src\/vs\/workbench\/services\/extensions\/node\/extensionHostSubprocess\.ts$/,
    // Тот же процессный барьер: runAsNode исполняется ТОЛЬКО в форке diode-бинаря
    // (DIODE_RUN_AS_NODE), а его гейты — child-process (runAsNode.eval.test.ts,
    // смоук build-sea, e2e lspBundled/eslintLsp) — покрытие в __stryker__ не
    // возвращают; из покрытия vitest файл исключён по той же причине.
    /^src\/vs\/diode\/runAsNode(\.testEntry)?\.ts$/,
    // Тот же процессный барьер: точка входа watcher-процесса исполняется ТОЛЬКО
    // в форке (DIODE_FILE_WATCHER), `globalThis.__stryker__` туда не проходит —
    // все мутанты выходят «не покрыты». Гейт у неё — child-process
    // (treeWatcherMain.integration.test.ts: правка файла на диске доезжает до
    // колбэка в процессе редактора) и e2e; из покрытия vitest файл исключён по
    // той же причине.
    /^src\/vs\/platform\/files\/node\/treeWatcherMain(\.testEntry)?\.ts$/,
    // Точка входа приложения: разбор CLI, бутстрап DI и подъём TUI. Юнит-тестов
    // у неё нет по устройству — она же исключена из покрытия в vitest.config.ts,
    // — поэтому все её мутанты выходят «не покрыты ни одним тестом» и убить их
    // юнитом нельзя. Проверяет её e2e против собранного бинаря (например
    // e2e/sea-install.test.ts, e2e/registry-install.test.ts), а логика, которую
    // есть смысл мутировать, живёт в модулях, которые main.ts только склеивает.
    /^src\/vs\/diode\/main\.ts$/,
    // Собранные артефакты расширений.
    /^extensions\/[^/]+\/out\//,
];

function git(args) {
    // Гасим пользовательские настройки, которые меняют формат вывода: без этого
    // разбор diff'а зависит от ~/.gitconfig того, кто запускает.
    const result = spawnSync("git", ["-c", "core.quotepath=false", "--no-pager", ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        // Дефолт spawnSync — 1 МБ, а дифф ночного окна в 270 коммитов — 11.7 МБ.
        // Переполнение убивает git SIGTERM'ом (ENOBUFS) с пустым stderr, и ночной
        // прогон с 2026-09-13 падал на первом же `git diff`, никому не сказав.
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
 * Разбирает `git diff -U0 --no-prefix` в карту «файл → диапазоны строк новой версии».
 *
 * Именно `--no-prefix`, а не парсинг `+++ b/…`: у пользователя может быть включён
 * `diff.mnemonicPrefix`, и тогда git печатает `+++ w/…`. Регулярка на `b/` в этом
 * случае не находит ни одного файла, скоуп выходит пустым — и гейт молча проходит,
 * не проверив ничего. Тихо-зелёный гейт хуже отсутствующего.
 */
function parseDiff(diff) {
    const scope = new Map();
    // Сколько файловых заголовков распознано — включая файлы, где мутировать
    // нечего (чистое удаление строк, удалённый файл). По нему, а не по размеру
    // скоупа, отличаем «сломан парсер» от «дифф из одних удалений».
    let headers = 0;
    let current = null;
    let prevWasOldFileHeader = false;

    for (const line of diff.split("\n")) {
        // `+++` считаем заголовком только сразу после `---`: добавленная строка
        // исходника `++ x` в диффе выглядит как `+++ x` и иначе сошла бы за имя файла.
        if (prevWasOldFileHeader && line.startsWith("+++ ")) {
            const file = line.slice(4);
            headers++;
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
    return { scope, headers };
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

const REPORT_DIR = path.join(repoRoot, "reports", "mutation");
const REPORT_PATH = path.join(REPORT_DIR, "mutation.json");
const GATE_PATH = path.join(REPORT_DIR, "gate.json");

// Исход прошлого прогона убираем первым делом: упади скрипт на любом шаге ниже
// (разбор аргументов, git), workflow прочёл бы оставшийся файл как исход этого.
rmSync(GATE_PATH, { force: true });

let args;
try {
    args = parseArgs(process.argv.slice(2));
} catch (error) {
    console.error(error.message);
    process.exit(2);
}
// `--scope-only` печатает скоуп и выходит: прогон на широко импортируемом файле
// стоит десятки минут, и перед ним полезно увидеть, что именно будет мутировано.
const { scopeOnly, strykerArgs } = args;
const incremental = strykerArgs.includes("--incremental");

/**
 * База по умолчанию — свежий `origin/main`: локальный `main` в долгоживущем
 * чекауте отстаёт на сотни коммитов, и дифф против него тащит в скоуп чужие
 * влитые PR. Сеть недоступна — работаем с тем `origin/main`, что есть, его
 * нет — с `main`. Явный `--base` не трогаем и не фетчим.
 */
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

/** Записывает исход прогона для workflow'ов и выходит. */
function finish(outcome, code, extra = {}) {
    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(GATE_PATH, JSON.stringify({ outcome, base, mergeBase, ...extra }, null, 2));
    process.exit(code);
}

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
    // Мутировать будем только продуктовый код — остальное и тащить незачем:
    // в окне ночного прогона львиная доля диффа — package-lock, доки и e2e.
    ...SOURCE_ROOTS,
]);
const { scope, headers } = parseDiff(diff);

// Защита от тихо-зелёного гейта: если git что-то выдал, а разобрать не удалось
// ни одного файлового заголовка — сломан парсер, а не пуст дифф. Падаем громко.
// Дифф из одних удалений строк заголовки даёт, а скоуп — нет: это честное
// «мутировать нечего».
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
 * Linux режет ОДИН аргумент командной строки на 128 КиБ (MAX_ARG_STRLEN), а
 * `--mutate` ночного окна в 270 коммитов — 196 КБ: spawn упал бы с E2BIG.
 * Большой скоуп отдаём Stryker'у конфигом — копией stryker.config.json с полем
 * `mutate`. Пути в JSON-конфиге Stryker резолвит от cwd, а не от файла, так что
 * класть копию можно куда угодно; `reports/` он и так игнорирует.
 */
const MUTATE_ARG_LIMIT = 100_000;
const SCOPE_CONFIG_PATH = path.join(repoRoot, "reports", "stryker.scope.json");

function runStryker(scope, extraArgs = []) {
    let target = ["--mutate", scope.join(",")];
    if (target[1].length > MUTATE_ARG_LIMIT) {
        const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
        // На свежем чекауте (ночной CI) каталога reports/ ещё нет.
        mkdirSync(path.dirname(SCOPE_CONFIG_PATH), { recursive: true });
        writeFileSync(SCOPE_CONFIG_PATH, JSON.stringify({ ...config, mutate: scope }, null, 2));
        target = [path.relative(repoRoot, SCOPE_CONFIG_PATH)];
    }
    return spawnSync("npx", ["stryker", "run", ...target, ...extraArgs, ...strykerArgs], {
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
function readReport() {
    if (!existsSync(REPORT_PATH)) return null;
    return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
}

/** Порог из конфига — тот же, по которому Stryker роняет свой прогон. */
function breakThreshold() {
    const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
    return config.thresholds?.break ?? null;
}

/** Почему мутанта пришлось гонять отдельно — видно прямо в отчёте. */
function recheckReason(mutant) {
    if (mutant.status === "RuntimeError") return "перепроверен точечным прогоном: в общем прогоне на нём упал раннер";
    if (!mutant.testsCompleted) return "перепроверен точечным прогоном: в общем прогоне не выполнилось ни одного теста";
    return (
        "перепроверен точечным прогоном: в общем прогоне выжил, точечно убит " +
        "(подбор тестов через vitest.related неполон, см. docs/TODO/MutationGateFlake.md)"
    );
}

/** Мутант, которого первый прогон не проверил: перепроверять — обязательно. */
function isUnchecked(mutant) {
    return mutant.status === "RuntimeError" || (mutant.status === "Survived" && !mutant.testsCompleted);
}

/**
 * Возвращает отчёт первого прогона на место точечного: комментарий в PR должен
 * показывать всю картину, а не тот кусок, который перепроверяли. Каждый
 * перепроверенный мутант получает статус точечного прогона — он и есть вердикт;
 * убитые — с причиной, чтобы в отчёте было видно, что их гоняли отдельно.
 *
 * Отдельно возвращает тех, на ком раннер упал и в точечном прогоне: их не
 * проверил ни один из двух прогонов, и молчать об этом нельзя.
 */
function mergeRecheckIntoReport(firstReport, recheckReport, recheckScope) {
    let rechecked = 0;
    const stillCrashed = [];
    const recheckStatus = new Map();
    for (const [file, data] of Object.entries(recheckReport.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            // В инкрементальном режиме Stryker дописывает в отчёт перепроверки и все
            // прошлые результаты из incremental-файла — считаем и разбираем только своих.
            if (!inScope(recheckScope, file, mutant)) continue;
            rechecked++;
            recheckStatus.set(mutantKey(file, mutant), mutant.status);
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
            if (!isUnchecked(mutant) && mutant.status !== "Survived") continue;
            const status = recheckStatus.get(mutantKey(file, mutant));
            if (status === undefined) continue;
            if (status === "Killed" || status === "Timeout") mutant.statusReason = recheckReason(mutant);
            mutant.status = status;
        }
    }
    writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
    return { rechecked, stillCrashed };
}

function classifyMutants(report) {
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

/**
 * Вердикт гейта — балл ИТОГОВОГО отчёта (первый прогон + перепроверка, только
 * мутанты скоупа) против порога конфига, по формуле Stryker'а. Не код возврата
 * Stryker'а: инкрементальный Stryker считает в свой балл и старых мутантов вне
 * `--mutate`, так что его код возврата мог краснеть от чужих выживших, а
 * комментарий — показывать зелёный (и наоборот).
 */
function verdict(report, extra = {}) {
    const threshold = breakThreshold();
    const { score } = scoreReport(report);
    const passed = threshold === null || score >= threshold;
    console.log(`\nМутационный балл по скоупу: ${score.toFixed(2)}% (порог ${String(threshold)}).`);
    finish(passed ? "passed" : "failed", passed ? 0 : 1, { score, threshold, ...extra });
}

/**
 * Прогон Stryker'а с гарантией, что прочитанный после него отчёт — его. Старый
 * `mutation.json` убирается ДО запуска: Stryker пишет отчёт в самом конце, и
 * если прогон умрёт раньше — штатный случай, его initial test run гоняет ВЕСЬ
 * сьют, включая сетевые тесты стоковых расширений, — на диске останется отчёт
 * прошлого прогона. Читая его, гейт выносил бы вердикт по чужим мутантам (ровно
 * так и вышло в #339 на перепроверке). Отчёт старше старта — та же ошибка.
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
    // Раньше здесь был тихий выход кодом первого прогона: workflow видел «нет
    // отчёта» и читал это как «мутировать нечего».
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
// Отфильтрованный отчёт — на диск сразу: из него собирается комментарий в PR и
// тикет, даже если дальше что-то упадёт.
writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
const classified = classifyMutants(firstReport);

if (classified.unchecked.length === 0 && classified.verified.length === 0) verdict(firstReport);

// Перепроверяем точечно всех выживших, а не только непроверенных: скоуп в одну
// строку на мутанта прогоняется надёжно. Выживший с выполненными тестами — тоже
// не приговор: подбор тестов через `vitest.related` неполон, и гейт записывает
// в Survived мутантов, которых тесты их файла убивают (docs/TODO/MutationGateFlake.md).
// В инкрементальном режиме это ещё и обязательно: иначе такой «выживший»
// переиспользовался бы из прошлого прогона без единого теста — до первой правки
// рядом. Скоуп — единицы мутантов, цена — секунды.
const recheckScope = [...classified.unchecked, ...classified.verified].map(({ file, start, end }) => ({
    file,
    start,
    end,
}));
const recheck = [...new Set(recheckScope.map(({ file, start, end }) => `${file}:${start}-${end}`))];
const lost = classified.unchecked.filter(({ status }) => status === "Survived").length;
const crashed = classified.unchecked.length - lost;
console.log(
    `\nВыживших: ${String(classified.verified.length)}, непроверенных: ${String(classified.unchecked.length)} ` +
        `(потерянных прогонов — ${String(lost)}, падений раннера — ${String(crashed)}). ` +
        `Непроверенный — не находка, выживший — не обязательно (см. docs/TESTING.md). Перепроверяю точечно:`,
);
for (const entry of recheck) console.log(`  ${entry}`);

// `--disableBail` именно здесь: потерянный прогон — это прогон, стартовавший
// следом за оборванным по bail, поэтому перепроверка с включённым bail сама
// теряет часть мутантов и выдаёт новых «выживших» вместо вердикта. На полном
// прогоне флаг неподъёмен (docs/TESTING.md), но скоуп перепроверки — единицы
// мутантов по одной строке, и цена «все покрывающие тесты на мутанта» тут
// секунды. Без него вердикт второго прогона нестабилен от запуска к запуску.
//
// `--force` в инкрементальном режиме: без него Stryker переиспользовал бы для
// перепроверяемых мутантов прошлый результат — тот самый «выжил», который мы и
// перепроверяем, — и не запустил бы ни одного теста. С `--force` он гоняет всё,
// что в скоупе, а результаты остальных мутантов из incremental-файла переносит
// как есть, так что следующий прогон видит перепроверенных уже убитыми.
const recheckArgs = ["--disableBail", ...(incremental ? ["--force"] : [])];
let recheckRun = runFresh(recheck, recheckArgs);

// Нет отчёта — прогон не доехал до конца, и о мутантах он не сказал ничего.
// Почти всегда это флак его initial test run, а не находка, поэтому один повтор
// дешевле красного PR: скоуп перепроверки — единицы мутантов по одной строке.
if (recheckRun.report === null) {
    console.log(
        "\nТочечный прогон не оставил отчёта — повторяю один раз " +
            "(обычно Stryker падает на initial test run, а не на самих мутантах).",
    );
    recheckRun = runFresh(recheck, recheckArgs);
}

if (recheckRun.report === null) {
    // Возвращаем картину первого прогона: без неё в PR не будет вообще никакого отчёта.
    writeFileSync(REPORT_PATH, JSON.stringify(firstReport));
    console.error(
        "\nТочечный прогон дважды не дошёл до отчёта — вердикта по непроверенным мутантам нет. " +
            "Смотри его вывод выше: в initial test run гоняется весь сьют, включая сетевые тесты " +
            "стоковых расширений, и падение там роняет прогон целиком.",
    );
    finish("error", 1, { reason: "точечный прогон дважды не оставил отчёта" });
}

const { rechecked, stillCrashed } = mergeRecheckIntoReport(firstReport, recheckRun.report, recheckScope);

// Пустая перепроверка — тихо-зелёный гейт: Stryker на скоупе без мутантов
// выходит нулём. Падаем громко, иначе «ничего не проверили» станет «всё хорошо».
if (rechecked === 0) {
    console.error(
        "Перепроверка не нашла ни одного мутанта в своём скоупе — гейт ничего не проверил. " +
            "Скорее всего разъехались диапазоны строк; чинить в scripts/mutation-diff.mjs.",
    );
    finish("error", 1, { reason: "перепроверка не нашла ни одного мутанта в своём скоупе" });
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
    finish("failed", 1, { reason: "раннер падает на мутантах и в точечном прогоне", stillCrashed });
}

verdict(firstReport);
