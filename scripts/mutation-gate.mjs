/** Чистая логика мутационного гейта — общая для `mutation-diff.mjs` и `mutation-report.mjs`. */

/**
 * `stryker run --help`, v10. Отличают значение флага (`--concurrency 4`) от
 * позиционного `[configFile]` (`--incremental X`).
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

/** Отдельный класс — для `.claude/hooks/bash-guard.mjs`: хук отказывает ровно там, где упал бы гейт. */
export class PositionalArgumentError extends Error {
    constructor(arg) {
        super(`Непонятный позиционный аргумент «${arg}». База диффа задаётся флагом: --base ${arg}`);
        this.arg = arg;
    }
}

/**
 * Позиционный аргумент — ошибка: npm-скрипт сам ставит `--ignoreStatic --incremental`
 * первыми, и `npm run test:mutation -- X` молча отдавал `X` Stryker'у как имя конфига.
 */
export function parseArgs(argv) {
    let base = null;
    let scopeOnly = false;
    const strykerArgs = [];
    const verify = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--scope-only") {
            scopeOnly = true;
            continue;
        }
        if (arg === "--verify-full") {
            verify.full = true;
            continue;
        }
        if (arg in VERIFY_NUMBER_FLAGS) {
            const value = Number(argv[++i]);
            if (!Number.isFinite(value) || value <= 0) throw new Error(`${arg} требует положительное число`);
            const [option, scale] = VERIFY_NUMBER_FLAGS[arg];
            verify[option] = value * scale;
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
                throw new PositionalArgumentError(arg);
            }
        }
        strykerArgs.push(arg);
    }
    return { base, scopeOnly, verify, strykerArgs: ensureJsonReporter(strykerArgs) };
}

/** Флаг → опция `verifyMutants` и множитель единицы. */
const VERIFY_NUMBER_FLAGS = {
    "--verify-jobs": ["jobs", 1],
    "--verify-timeout": ["timeoutMs", 1000],
    "--verify-budget": ["budgetMs", 60_000],
};

/** Без json-репортёра нет `mutation.json`, а с ним и вердикта; остальные репортёры остаются. */
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
 * Состав — как у Stryker'а (`mutantToIdentifyingKey`). Без конца и замены `→ true`
 * и `→ false` на одной позиции склеивались, и убитый записывал убитым второго.
 */
export function mutantKey(file, mutant) {
    const { start, end } = mutant.location;
    return `${file}@${start.line}:${start.column}-${end.line}:${end.column}\n${mutant.mutatorName}: ${String(mutant.replacement)}`;
}

export function parseScope(entries) {
    return entries.map((entry) => {
        const match = /^(.*):(\d+)-(\d+)$/.exec(entry);
        if (match === null) return { file: entry, start: 1, end: Infinity };
        return { file: match[1], start: Number(match[2]), end: Number(match[3]) };
    });
}

/** Целиком внутри диапазона — как `locationIncluded` инструментатора Stryker'а. */
export function inScope(scope, file, mutant) {
    const start = mutant.location?.start?.line;
    if (start === undefined) return false;
    const end = mutant.location?.end?.line ?? start;
    return scope.some((entry) => entry.file === file && start >= entry.start && end <= entry.end);
}

/** Инкрементальный Stryker дописывает старые результаты вне `--mutate` — из прошлых веток и до ребейза. */
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
 * Ровно по формуле Stryker'а (`mutation-testing-metrics`). Пустой знаменатель — 100
 * (у Stryker'а NaN, и порог он тоже не роняет).
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
