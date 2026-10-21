/**
 * Чистая логика самопроверки мутационного гейта, без процессов и ФС (их делает
 * `verify-mutants.mjs`).
 *
 * Зачем: Stryker с `perTest` и `vitest.related` пишет в Survived мутантов, которых
 * тесты убивают, а руками их разоблачали неправильно — вживляли «смысл» мутанта
 * (`if (false)` на всё условие вместо левого операнда `||`), и настоящие дыры
 * уезжали в фантомы (#343).
 */

import { mutantKey } from "./mutation-gate.mjs";

/**
 * Порядок — порядок показа.
 *
 *   real          — все подобранные тесты зелёные с мутантом: настоящая дыра;
 *   runtime-error — тесты не упали, но упал сам vitest (unhandled error, воркер):
 *                   CI красный, а балл Stryker'а этого не видит;
 *   inconclusive  — вердикта нет: красные без мутанта, некого гонять, не
 *                   повторилось, кончился бюджет;
 *   timeout       — vitest с мутантом не уложился во время;
 *   stale         — исходник не тот, к которому Stryker применил мутанта;
 *   phantom       — тест, зелёный без мутанта, с ним краснеет (повторно).
 */
export const CLASSES = ["real", "runtime-error", "inconclusive", "timeout", "stale", "phantom"];

/** Красят гейт сами по себе; `real` красит через балл (остаётся Survived/NoCoverage). */
export const BLOCKING_CLASSES = new Set(["runtime-error", "inconclusive", "timeout", "stale"]);

export function isCandidate(mutant) {
    return mutant.status === "Survived" || mutant.status === "NoCoverage" || mutant.status === "RuntimeError";
}

/** line и column отчёта Stryker'а — обе 1-based. */
export function offsetOf(text, position) {
    let offset = 0;
    for (let line = 1; line < position.line; line++) {
        const next = text.indexOf("\n", offset);
        if (next < 0) throw new Error(`строки ${String(position.line)} нет в тексте`);
        offset = next + 1;
    }
    const lineEnd = text.indexOf("\n", offset);
    const lineLength = (lineEnd < 0 ? text.length : lineEnd) - offset;
    // Конец мутанта может стоять сразу за последним символом строки (column = длина + 1).
    if (position.column < 1 || position.column - 1 > lineLength) {
        throw new Error(`колонки ${String(position.column)} нет в строке ${String(position.line)}`);
    }
    return offset + position.column - 1;
}

/** Дословно, ничего «по смыслу»: Stryker часто мутирует ПОЛОВИНУ выражения (левый операнд `||`). */
export function applyMutant(source, mutant) {
    const from = offsetOf(source, mutant.location.start);
    const to = offsetOf(source, mutant.location.end);
    if (to < from) throw new Error("конец мутанта раньше начала");
    return source.slice(0, from) + String(mutant.replacement ?? "") + source.slice(to);
}

export function coveringTestFiles(report, mutant) {
    const ids = new Set(mutant.coveredBy ?? []);
    if (ids.size === 0) return [];
    const files = [];
    for (const [file, data] of Object.entries(report.testFiles ?? {})) {
        if ((data.tests ?? []).some((test) => ids.has(test.id))) files.push(file);
    }
    return files.sort();
}

export function siblingTestFiles(sourceFile, allFiles) {
    const slash = sourceFile.lastIndexOf("/");
    const dir = sourceFile.slice(0, slash + 1);
    const base = sourceFile.slice(slash + 1).replace(/\.ts$/, "");
    return allFiles
        .filter((file) => {
            if (!file.startsWith(dir) || file.slice(dir.length).includes("/")) return false;
            const name = file.slice(dir.length);
            return name === `${base}.test.ts` || (name.startsWith(`${base}.`) && name.endsWith(".test.ts"));
        })
        .sort();
}

const IMPORT_PATTERNS = [
    /\b(?:import|export)\s[^;'"`]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\b(?:import|require|vi\.mock|vi\.doMock)\s*\(\s*["']([^"']+)["']/g,
];

export function importSpecifiers(text) {
    const found = new Set();
    for (const pattern of IMPORT_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
            if (match[1].startsWith("./") || match[1].startsWith("../")) found.add(match[1]);
        }
    }
    return [...found];
}

function normalize(file) {
    const out = [];
    for (const part of file.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") out.pop();
        else out.push(part);
    }
    return out.join("/");
}

export function resolveSpecifier(fromFile, specifier, known) {
    const dir = fromFile.slice(0, fromFile.lastIndexOf("/") + 1);
    const target = normalize(dir + specifier);
    const candidates = [target, target.replace(/\.(m?js)$/, ".ts"), `${target}.ts`, `${target}/index.ts`];
    return candidates.find((candidate) => known.has(candidate)) ?? null;
}

/**
 * Свой, а не `vitest related`: тот поднимает сервер vite на каждый вызов. Граф шире
 * настоящего (импорт в комментарии — тоже ребро), и это безопасная сторона:
 * лишний тест стоит секунд, пропущенный — фантома.
 */
export function buildReverseImportGraph(sources) {
    const known = new Set(sources.keys());
    const importers = new Map();
    for (const [file, text] of sources) {
        for (const specifier of importSpecifiers(text)) {
            const target = resolveSpecifier(file, specifier, known);
            if (target === null) continue;
            if (!importers.has(target)) importers.set(target, new Set());
            importers.get(target).add(file);
        }
    }
    return importers;
}

export function relatedTestFiles(file, importers) {
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length > 0) {
        const current = queue.shift();
        for (const importer of importers.get(current) ?? []) {
            if (seen.has(importer)) continue;
            seen.add(importer);
            queue.push(importer);
        }
    }
    return [...seen].filter((candidate) => candidate.endsWith(".test.ts")).sort();
}

/** `failedFiles` — упавшие целиком (не загрузились, упал хук) без единого упавшего теста. */
export function parseVitestJson(json) {
    const passed = new Set();
    const failed = new Set();
    const failedFiles = new Set();
    const ranFiles = new Set();
    for (const result of json.testResults ?? []) {
        const file = result.name;
        ranFiles.add(file);
        let failedHere = false;
        for (const assertion of result.assertionResults ?? []) {
            const key = `${file} > ${assertion.fullName}`;
            if (assertion.status === "passed") passed.add(key);
            else if (assertion.status === "failed") {
                failed.add(key);
                failedHere = true;
            }
        }
        if (result.status === "failed" && !failedHere) failedFiles.add(file);
    }
    return { passed, failed, failedFiles, ranFiles, total: json.numTotalTests ?? passed.size + failed.size };
}

/** Упавшее и без мутанта уликой не считается — иначе красный от сети тест записывал бы фантомов. */
export function killers(baseline, mutated) {
    const tests = [...mutated.failed].filter((key) => baseline.passed.has(key));
    const files = [...mutated.failedFiles].filter(
        (file) =>
            baseline.ranFiles.has(file) &&
            !baseline.failedFiles.has(file) &&
            ![...baseline.failed].some((key) => key.startsWith(`${file} > `)),
    );
    return { tests: tests.sort(), files: files.sort(), any: tests.length + files.length > 0 };
}

export function baselineIsRed(baseline) {
    return baseline.failed.size > 0 || baseline.failedFiles.size > 0;
}

const RUNTIME_ERROR_MARKERS = [
    /Unhandled (?:Errors?|Rejection)/i,
    /Worker exited unexpectedly/i,
    /Channel closed/i,
    /ERR_IPC_CHANNEL_CLOSED/,
];

export function runtimeErrorExcerpt(output) {
    const lines = output.split("\n");
    const at = lines.findIndex((line) => RUNTIME_ERROR_MARKERS.some((marker) => marker.test(line)));
    if (at < 0) return null;
    const clean = (line) =>
        line
            .replace(/\u001b\[[0-9;]*m/g, "")
            .replace(/⎯+/g, "")
            .trim();
    // Шапка vitest ничего не объясняет — нужна сама ошибка.
    const meaningful = lines
        .slice(at + 1, at + 30)
        .map(clean)
        .filter(
            (line) =>
                line !== "" &&
                !/^[⎯\s]+$/.test(line) &&
                !/Vitest caught|false positive|Unhandled (?:Errors?|Rejection)\s*⎯/i.test(line),
        );
    const header = clean(lines[at]).replace(/[⎯]+/g, "").trim();
    return [header, ...meaningful.slice(0, 5)].join("\n");
}

function originalText(source, mutant) {
    return source.slice(offsetOf(source, mutant.location.start), offsetOf(source, mutant.location.end));
}

const BOUNDARY_PAIRS = new Map([
    ["<", "<="],
    ["<=", "<"],
    [">", ">="],
    [">=", ">"],
]);

/**
 * Только подсказка поверх `real`: гейт красит так же, решает человек. Эвристики —
 * по трём случаям, что чаще всего оказывались эквивалентными.
 */
export function equivalentHint(source, mutant, siblings) {
    let original;
    try {
        original = originalText(source, mutant);
    } catch {
        return null;
    }
    const replacement = String(mutant.replacement ?? "");
    if (mutant.mutatorName === "EqualityOperator") {
        const op = /\s(<=|>=|<|>)\s/.exec(` ${original} `)?.[1];
        const swapped = op === undefined ? null : original.replace(op, BOUNDARY_PAIRS.get(op));
        if (swapped !== null && swapped === replacement)
            return "граничный оператор: на границе обе ветки могут давать одно и то же";
    }
    if (mutant.mutatorName === "StringLiteral" && /\s|[а-яё]/i.test(original.slice(1, -1))) {
        return "человекочитаемая строка (сообщение, подпись, лог) — проверь, нужен ли ассерт на текст";
    }
    if (mutant.mutatorName === "ConditionalExpression" && (replacement === "true" || replacement === "false")) {
        const sameSpot = siblings.filter(
            (other) =>
                other !== mutant &&
                other.mutatorName === "ConditionalExpression" &&
                other.location.start.line === mutant.location.start.line &&
                other.location.start.column === mutant.location.start.column &&
                other.location.end.line === mutant.location.end.line &&
                other.location.end.column === mutant.location.end.column,
        );
        if (sameSpot.some((other) => other.status === "Killed" || other.status === "Timeout")) {
            return `охраняющее условие: «→ ${replacement === "true" ? "false" : "true"}» убит, а «→ ${replacement}» нет — ветка может повторять то, что дальше и так случится`;
        }
    }
    return null;
}

/** `verification` — чтобы отчёт PR показывал класс, а не голый статус. */
export function mergeVerdicts(report, verdicts) {
    const byKey = new Map(verdicts.map((verdict) => [verdict.key, verdict]));
    for (const [file, data] of Object.entries(report.files ?? {})) {
        for (const mutant of data.mutants ?? []) {
            const verdict = byKey.get(mutantKey(file, mutant));
            if (verdict === undefined) continue;
            mutant.verification = {
                class: verdict.class,
                reason: verdict.reason,
                hint: verdict.hint ?? null,
                tests: verdict.tests ?? [],
            };
            if (verdict.class === "phantom") {
                mutant.status = "Killed";
                mutant.statusReason = `verified by injection: ${verdict.reason}`;
            } else if (verdict.class === "runtime-error") {
                mutant.status = "RuntimeError";
                mutant.statusReason = `verified by injection: ${verdict.reason}`;
            } else if (verdict.class === "real" && mutant.status === "RuntimeError") {
                // На перепроверке раннер не падал, а тесты зелёные — дыра настоящая.
                mutant.status = "Survived";
                mutant.statusReason = `verified by injection: ${verdict.reason}`;
            } else {
                mutant.statusReason = `${verdict.class}: ${verdict.reason}`;
            }
        }
    }
    return report;
}

/** Все классы, нули тоже. */
export function countClasses(verdicts) {
    const counts = Object.fromEntries(CLASSES.map((name) => [name, 0]));
    for (const verdict of verdicts) counts[verdict.class]++;
    return counts;
}

export function blockingVerdicts(verdicts) {
    return verdicts.filter((verdict) => BLOCKING_CLASSES.has(verdict.class));
}
