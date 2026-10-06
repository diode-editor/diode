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
 *                   Переиспользованный «выживший» всё равно перепроверяется вживлением.
 *                   Полный пересчёт без переиспользования — `-- --incremental --force`.
 *   --verify-jobs N        перепроверка в N песочницах параллельно (по умолчанию 1:
 *                          каждый vitest и так занимает все ядра);
 *   --verify-full          третий этап перепроверки — весь сьют для тех, кого не
 *                          убили ни покрывающие, ни импортирующие тесты;
 *   --verify-timeout <с>   таймаут одного прогона vitest (по умолчанию 120 с + 3 с
 *                          на тест-файл);
 *   --verify-budget <мин>  бюджет всей перепроверки: не успевшие — inconclusive.
 *
 * После прогона Stryker'а каждый мутант, которого он не записал убитым
 * (Survived, NoCoverage, RuntimeError), перепроверяется вживлением точного
 * мутанта и узким прогоном vitest (`scripts/verify-mutants.mjs`) и получает
 * класс: real / phantom / runtime-error / inconclusive / timeout / stale.
 * Фантомы становятся Killed, классы — в `reports/mutation/verdict.json`.
 *
 * Исход прогона скрипт пишет в `reports/mutation/gate.json`
 * (`{ outcome: "empty-scope" | "passed" | "failed" | "error", classes, … }`). Нет файла —
 * скрипт упал, не дойдя до вердикта. По нему workflow'ы отличают «мутировать
 * нечего» от «прогон сломался»: по одному отсутствию `mutation.json` это не
 * различить, и ночной прогон три недели зеленел, ничего не проверяя.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { filterReportToScope, parseArgs, parseScope, scoreReport } from "./mutation-gate.mjs";
import { blockingVerdicts, countClasses, isCandidate, mergeVerdicts } from "./mutation-inject.mjs";
import { formatSummary, verifyMutants, writeVerdictFile } from "./verify-mutants.mjs";

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

function readReport() {
    if (!existsSync(REPORT_PATH)) return null;
    return JSON.parse(readFileSync(REPORT_PATH, "utf8"));
}

/** Порог из конфига — тот же, по которому Stryker роняет свой прогон. */
function breakThreshold() {
    const config = JSON.parse(readFileSync(path.join(repoRoot, "stryker.config.json"), "utf8"));
    return config.thresholds?.break ?? null;
}

/**
 * Вердикт гейта. Две половины, и обе — по итоговому отчёту (первый прогон +
 * перепроверка вживлением, только мутанты скоупа):
 *
 *   - балл по формуле Stryker'а против порога конфига: `real` остаётся
 *     Survived/NoCoverage и роняет балл, `phantom` стал Killed и не роняет;
 *   - классы без вердикта (runtime-error, inconclusive, timeout, stale) красят
 *     гейт сами: балл их не видит (RuntimeError вне знаменателя, остальные
 *     сохраняют статус Stryker'а), а «не смогли проверить» — не «проверено».
 *
 * Не код возврата Stryker'а: инкрементальный Stryker считает в свой балл и
 * старых мутантов вне `--mutate`.
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
                "пока их не разберут (docs/TESTING.md).",
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
// Самопроверка: каждого, кого Stryker не записал убитым, вживляем точно и
// гоняем vitest сами (scripts/verify-mutants.mjs). Раньше здесь был второй
// прогон Stryker'а построчным скоупом — он не лечил промах подбора тестов
// (`vitest.related`, perTest-покрытие) и сам флакал на initial test run (#339).
const candidates = Object.values(firstReport.files ?? {}).flatMap((data) => (data.mutants ?? []).filter(isCandidate));
if (candidates.length === 0) verdict(firstReport);

console.log(
    `\nНе убито Stryker'ом: ${String(candidates.length)}. Перепроверяю каждого вживлением точного мутанта ` +
        "(фантом / настоящий / без вердикта — см. docs/TESTING.md):",
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
