/**
 * Чистая логика мутационного гейта: разбор аргументов, ключ мутанта, скоуп,
 * балл. Вынесена из `mutation-diff.mjs` и `mutation-report.mjs`, чтобы оба
 * скрипта считали одинаково, а сама логика проверялась тестом
 * (`mutation-gate.test.mjs`, `node --test`), без Stryker'а и git'а.
 */

/**
 * Флаги Stryker'а без значения (`stryker run --help`, v10). Нужны, чтобы
 * отличить значение флага (`--concurrency 4`) от позиционного аргумента
 * (`--incremental X`): у Stryker'а позиционный — это `[configFile]`.
 */
const STRYKER_BOOLEAN_FLAGS = new Set([
    "--ignoreStatic",
    "--incremental",
    "--allowEmpty",
    "--force",
    "--dryRunOnly",
    "--disableBail",
    "--inPlace",
]);

/**
 * Разбирает аргументы `mutation-diff.mjs`.
 *
 * База задаётся только флагом `--base <ref>`. Раньше ею был первый позиционный
 * аргумент, и `npm run test:mutation -- X` ломался молча: npm-скрипт сам ставит
 * `--ignoreStatic --incremental` первыми, база тихо становилась `main`, а `X`
 * уезжал Stryker'у как имя конфига. Поэтому любой позиционный аргумент теперь —
 * ошибка с подсказкой, а не догадка.
 */
export function parseArgs(argv) {
    let base = null;
    let scopeOnly = false;
    const strykerArgs = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--scope-only") {
            scopeOnly = true;
            continue;
        }
        if (arg === "--base" || arg.startsWith("--base=")) {
            const value = arg === "--base" ? argv[++i] : arg.slice("--base=".length);
            if (value === undefined || value === "" || value.startsWith("-")) {
                throw new Error("--base требует ревизию: --base <ref>");
            }
            base = value;
            continue;
        }
        if (!arg.startsWith("-")) {
            const prev = strykerArgs.at(-1);
            const isFlagValue = prev !== undefined && prev.startsWith("-") && !prev.includes("=") && !STRYKER_BOOLEAN_FLAGS.has(prev);
            if (!isFlagValue) {
                throw new Error(
                    `Непонятный позиционный аргумент «${arg}». База диффа задаётся флагом: --base ${arg}`,
                );
            }
        }
        strykerArgs.push(arg);
    }
    return { base, scopeOnly, strykerArgs: ensureJsonReporter(strykerArgs) };
}

/**
 * Гейт читает `mutation.json` — без json-репортёра отчёта не будет, и вердикт
 * выйдет «нет отчёта» вместо результата. Явный `--reporters` без `json`
 * дополняем, а не отвергаем: остальные репортёры остаются как просили.
 */
export function ensureJsonReporter(args) {
    return args.map((arg, i) => {
        if (arg.startsWith("--reporters=")) return `--reporters=${withJson(arg.slice("--reporters=".length))}`;
        if (args[i - 1] === "--reporters") return withJson(arg);
        return arg;
    });
}

function withJson(list) {
    const reporters = list.split(",").filter(Boolean);
    return reporters.includes("json") ? list : [...reporters, "json"].join(",");
}

/**
 * Ключ мутанта, по которому сводятся отчёты двух прогонов. Тот же состав, что
 * у Stryker'а (`mutantToIdentifyingKey` в incremental-differ): файл, начало И
 * конец, мутатор, замена. Без конца и замены `ConditionalExpression → true` и
 * `→ false` на одной позиции склеивались, и убитый на перепроверке один
 * записывал убитым и выжившего второго.
 */
export function mutantKey(file, mutant) {
    const { start, end } = mutant.location;
    return `${file}@${start.line}:${start.column}-${end.line}:${end.column}\n${mutant.mutatorName}: ${String(mutant.replacement)}`;
}

/**
 * Скоуп `--mutate` в виде диапазонов: `file` — весь файл, `file:a-b` — строки.
 * Семантика — как у инструментатора Stryker'а: мутант в скоупе, только если
 * целиком внутри диапазона (`locationIncluded`).
 */
export function parseScope(entries) {
    return entries.map((entry) => {
        const match = /^(.*):(\d+)-(\d+)$/.exec(entry);
        if (match === null) return { file: entry, start: 1, end: Infinity };
        return { file: match[1], start: Number(match[2]), end: Number(match[3]) };
    });
}

/** Мутант лежит в скоупе: тот же файл, строки внутри одного из диапазонов. */
export function inScope(scope, file, mutant) {
    const start = mutant.location?.start?.line;
    if (start === undefined) return false;
    const end = mutant.location?.end?.line ?? start;
    return scope.some((entry) => entry.file === file && start >= entry.start && end <= entry.end);
}

/**
 * Оставляет в отчёте только мутантов скоупа. Инкрементальный Stryker
 * дописывает в отчёт старые результаты из `stryker-incremental.json` вне
 * текущего `--mutate` — чужие выжившие из прошлых веток и до ребейза. Ни
 * перепроверять, ни показывать, ни считать в балл их нельзя: к этому диффу они
 * отношения не имеют. Возвращает, сколько выброшено.
 */
export function filterReportToScope(report, scope) {
    let dropped = 0;
    for (const [file, data] of Object.entries(report.files ?? {})) {
        const kept = (data.mutants ?? []).filter((mutant) => inScope(scope, file, mutant));
        dropped += (data.mutants ?? []).length - kept.length;
        if (kept.length === 0) delete report.files[file];
        else data.mutants = kept;
    }
    return dropped;
}

/**
 * Балл ровно по формуле Stryker'а (`mutation-testing-metrics`): в знаменателе
 * только проверенные — убитые, по таймауту, выжившие и непокрытые.
 * `RuntimeError`/`CompileError`, `Ignored` и `Pending` в балл не входят. Пустой
 * знаменатель — 100: проверять было нечего (у Stryker'а это NaN, и порог он тоже
 * не роняет).
 */
export function scoreReport(report) {
    const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0, RuntimeError: 0, CompileError: 0, Ignored: 0, Pending: 0 };
    for (const data of Object.values(report.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            if (mutant.status in counts) counts[mutant.status]++;
        }
    }
    const detected = counts.Killed + counts.Timeout;
    const valid = detected + counts.Survived + counts.NoCoverage;
    return { counts, detected, valid, score: valid === 0 ? 100 : (detected / valid) * 100 };
}
