#!/usr/bin/env node
/**
 * Самопроверка мутационного гейта: каждого мутанта, которого Stryker не
 * записал убитым (Survived, NoCoverage, RuntimeError), вживляем РОВНО так, как
 * его вносил Stryker (`location.start`–`location.end` → `replacement`, по
 * `files[f].source` из отчёта), гоняем vitest и присваиваем класс — real,
 * phantom, runtime-error, inconclusive, timeout, stale (что значит каждый —
 * `CLASSES` в `mutation-inject.mjs` и docs/TESTING.md).
 *
 * Зовётся из `mutation-diff.mjs` после прогона Stryker'а, а руками — так:
 *
 *   node scripts/verify-mutants.mjs [<mutation.json>] [--filter <подстрока пути>]
 *       [--limit N] [--jobs N] [--full] [--timeout <сек>] [--budget <мин>] [--root <проект>]
 *
 * Отчёт по умолчанию — reports/mutation/mutation.json; вердикты пишутся в
 * reports/mutation/verdict.json, а сам отчёт дополняется классами (фантомы
 * становятся Killed). Код возврата: 0 — блокирующих классов нет, 1 — есть.
 *
 * Как выносится вердикт — этапами, от дешёвого к дорогому:
 *
 *   1. тесты, которые Stryker записал покрывающими (`coveredBy`), и соседние
 *      `<имя>*.test.ts`;
 *   2. все тесты, которые транзитивно импортируют файл (граф импортов —
 *      то же, что `vitest related`, но без сервера vite на каждый вызов);
 *   3. (`--full`) весь сьют.
 *
 * Упал тест на каком-то этапе — проверяем, что это мутант, а не тест: те же
 * файлы гоняются БЕЗ мутанта (уликой считается только тест, зелёный без него)
 * и ещё раз С мутантом (падение должно повториться — флак фантомом не делаем).
 * Зелёные все этапы — `real`. Без мутанта набор гоняется только по упавшим
 * файлам и кэшируется на прогон: связанный набор горячего файла — сотни
 * тест-файлов, и гнать его дважды на каждого мутанта нельзя.
 *
 * Вживление идёт в ПЕСОЧНИЦЕ — копии проекта в `.stryker-tmp/verify-*` с
 * симлинком на node_modules, как у Stryker'а. Рабочее дерево не трогается
 * никогда: прерванный прогон не оставляет мутанта в исходнике, а редактор и
 * соседние сессии не видят чужой правки.
 */

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import {
    applyMutant,
    baselineIsRed,
    blockingVerdicts,
    buildReverseImportGraph,
    countClasses,
    coveringTestFiles,
    equivalentHint,
    isCandidate,
    killers,
    mergeVerdicts,
    parseVitestJson,
    relatedTestFiles,
    runtimeErrorExcerpt,
    siblingTestFiles,
} from "./mutation-inject.mjs";
import { mutantKey } from "./mutation-gate.mjs";

/** Что не копируем в песочницу: то же, что Stryker не берёт в свою. */
const SANDBOX_SKIP = new Set(["node_modules", ".git", ".stryker-tmp", "reports", "dist", "coverage", ".claude"]);

/**
 * Файлы проекта: из git (отслеживаемые и неигнорируемые новые — ровно то, что
 * видит задача), а вне git-репозитория — обходом каталога. Второе нужно
 * синтетическим проектам из тестов скрипта.
 */
export function listProjectFiles(root) {
    const git = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });
    if (
        git.status === 0 &&
        spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" }).stdout.trim() ===
            path.resolve(root)
    ) {
        return git.stdout.split("\0").filter((file) => file !== "" && existsSync(path.join(root, file)));
    }
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
            if (SANDBOX_SKIP.has(entry.name)) continue;
            const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
            if (entry.isDirectory()) walk(rel);
            else out.push(rel);
        }
    };
    walk("");
    return out;
}

/** Песочница: копия файлов проекта, node_modules — симлинком. */
function createSandbox(root, files, index) {
    const dir = path.join(root, ".stryker-tmp", `verify-${String(process.pid)}-${String(index)}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const file of files) {
        if (SANDBOX_SKIP.has(file.split("/")[0])) continue;
        // Копия, не жёсткая ссылка: вживление пишет в файл, и с общей inode
        // мутант оказался бы в рабочем дереве.
        cpSync(path.join(root, file), path.join(dir, file), { dereference: true });
    }
    if (existsSync(path.join(root, "node_modules")))
        symlinkSync(path.join(root, "node_modules"), path.join(dir, "node_modules"), "dir");
    return dir;
}

/**
 * Один прогон vitest в песочнице. Процесс — в своей группе: на таймауте
 * убиваем и воркеры vitest, иначе зациклившийся мутантом форк пережил бы нас.
 */
function runVitest(sandbox, testFiles, { bail, timeoutMs, label }) {
    const outFile = path.join(
        sandbox,
        ".verify-out",
        `${label}-${String(Date.now())}-${String(Math.random()).slice(2, 8)}.json`,
    );
    mkdirSync(path.dirname(outFile), { recursive: true });
    const args = [
        path.join(sandbox, "node_modules", "vitest", "vitest.mjs"),
        "run",
        "--reporter=dot",
        "--reporter=json",
        `--outputFile.json=${outFile}`,
        "--no-cache",
        "--silent",
        "--passWithNoTests",
        ...(bail ? ["--bail=1"] : []),
        ...testFiles,
    ];
    return new Promise((resolve) => {
        const child = spawn(process.execPath, args, {
            cwd: sandbox,
            detached: true,
            env: { ...process.env, FORCE_COLOR: "0" },
        });
        activeChildren.add(child);
        let output = "";
        const keep = (chunk) => {
            output += chunk;
            // Нужен только хвост: там сводка vitest и Unhandled Errors.
            if (output.length > 400_000) output = output.slice(-200_000);
        };
        child.stdout.on("data", keep);
        child.stderr.on("data", keep);
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            killGroup(child);
        }, timeoutMs);
        child.on("close", (code, signal) => {
            clearTimeout(timer);
            activeChildren.delete(child);
            let json = null;
            try {
                json = JSON.parse(readFileSync(outFile, "utf8"));
            } catch {
                json = null;
            }
            rmSync(outFile, { force: true });
            resolve({
                code,
                signal,
                timedOut,
                output,
                result: json === null ? null : relativize(parseVitestJson(json), sandbox),
            });
        });
    });
}

const activeChildren = new Set();

function killGroup(child) {
    try {
        process.kill(-child.pid, "SIGKILL");
    } catch {
        child.kill("SIGKILL");
    }
}

/** Пути в json vitest абсолютные (в песочнице) — приводим к путям проекта. */
function relativize(parsed, sandbox) {
    const rel = (file) => path.relative(sandbox, file).split(path.sep).join("/");
    const mapKey = (key) => {
        const at = key.indexOf(" > ");
        return `${rel(key.slice(0, at))}${key.slice(at)}`;
    };
    return {
        passed: new Set([...parsed.passed].map(mapKey)),
        failed: new Set([...parsed.failed].map(mapKey)),
        failedFiles: new Set([...parsed.failedFiles].map(rel)),
        ranFiles: new Set([...parsed.ranFiles].map(rel)),
        total: parsed.total,
    };
}

/** Тест-файлы, которых коснулся результат: упавшие тесты и файлы целиком. */
function filesOf(result) {
    const files = new Set(result.failedFiles);
    for (const key of result.failed) files.add(key.slice(0, key.indexOf(" > ")));
    return [...files].sort();
}

/** Склейка результатов нескольких прогонов в один (для кэша без мутанта). */
function mergeResults(results) {
    const merged = { passed: new Set(), failed: new Set(), failedFiles: new Set(), ranFiles: new Set(), total: 0 };
    for (const result of results) {
        for (const field of ["passed", "failed", "failedFiles", "ranFiles"])
            for (const value of result[field]) merged[field].add(value);
        merged.total += result.total;
    }
    return merged;
}

/**
 * Перепроверяет кандидатов отчёта. Возвращает вердикты `{ key, file, line,
 * mutatorName, replacement, class, reason, hint, tests, stage }`.
 *
 * `root` — корень проекта (в нём ищутся исходники для сверки с отчётом и
 * делается песочница), `report` — отчёт Stryker'а (`mutation.json`).
 */
export async function verifyMutants({
    root,
    report,
    filter = null,
    limit = Infinity,
    jobs = 1,
    full = false,
    timeoutMs = null,
    budgetMs = Infinity,
    log = (line) => process.stdout.write(`${line}\n`),
}) {
    const startedAt = Date.now();
    const candidates = [];
    for (const [file, data] of Object.entries(report.files ?? {})) {
        if (filter !== null && !file.includes(filter)) continue;
        for (const mutant of data.mutants ?? []) {
            if (isCandidate(mutant)) candidates.push({ file, mutant, source: data.source, siblings: data.mutants });
        }
    }
    candidates.sort(
        (a, b) =>
            a.file.localeCompare(b.file) ||
            a.mutant.location.start.line - b.mutant.location.start.line ||
            a.mutant.location.start.column - b.mutant.location.start.column,
    );
    const picked = candidates.slice(0, limit);
    if (picked.length === 0) return [];

    const files = listProjectFiles(root);
    const testFiles = files.filter((file) => file.endsWith(".test.ts"));
    const sourceFiles = files.filter((file) => file.endsWith(".ts") && !file.startsWith("node_modules/"));
    const sources = new Map(sourceFiles.map((file) => [file, readFileSync(path.join(root, file), "utf8")]));
    const importers = buildReverseImportGraph(sources);

    const sandboxes = Array.from({ length: Math.max(1, Math.min(jobs, picked.length)) }, (_, index) =>
        createSandbox(root, files, index),
    );
    const cleanup = () => {
        for (const child of activeChildren) killGroup(child);
        for (const sandbox of sandboxes) rmSync(sandbox, { recursive: true, force: true });
    };
    // Рабочее дерево мутант не трогает, но песочницы и воркеры vitest по Ctrl+C
    // надо убрать: иначе зациклившийся форк остаётся жить.
    const onSignal = () => {
        cleanup();
        process.exit(130);
    };
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, onSignal);

    // Без мутанта набор не меняется от мутанта к мутанту — кэшируем по файлу.
    const baselineCache = new Map();
    async function baseline(sandbox, list, perRunTimeout) {
        const missing = list.filter((file) => !baselineCache.has(file));
        if (missing.length > 0) {
            const run = runVitest(sandbox, missing, { bail: false, timeoutMs: perRunTimeout, label: "baseline" });
            for (const file of missing)
                baselineCache.set(
                    file,
                    run.then((done) => ({ ...done, only: file })),
                );
        }
        const runs = await Promise.all(list.map((file) => baselineCache.get(file)));
        const unusable = runs.find((run) => run.result === null || run.timedOut);
        if (unusable !== undefined)
            return {
                error: unusable.timedOut
                    ? "прогон без мутанта не уложился в таймаут"
                    : "прогон без мутанта не оставил отчёта",
            };
        // Из общего прогона — только строки своего файла.
        const parts = runs.map((run) => {
            const file = run.only;
            const pick = (set) => new Set([...set].filter((key) => key === file || key.startsWith(`${file} > `)));
            return {
                passed: pick(run.result.passed),
                failed: pick(run.result.failed),
                failedFiles: pick(run.result.failedFiles),
                ranFiles: pick(run.result.ranFiles),
                total: 0,
            };
        });
        // Упал ли vitest без мутанта вне тестов (unhandled error) — нужно, чтобы
        // не записать мутанту чужое падение.
        const crashed = runs.some(
            (run) => run.code !== 0 && run.result.failed.size === 0 && run.result.failedFiles.size === 0,
        );
        return { result: mergeResults(parts), crashed };
    }

    const timeoutFor = (count) => timeoutMs ?? 120_000 + count * 3_000;

    async function verifyOne(sandbox, { file, mutant, source, siblings }) {
        const where = {
            key: mutantKey(file, mutant),
            file,
            line: mutant.location.start.line,
            column: mutant.location.start.column,
            mutatorName: mutant.mutatorName,
            replacement: String(mutant.replacement ?? ""),
            status: mutant.status,
        };
        const verdict = (cls, reason, extra = {}) => ({
            ...where,
            class: cls,
            reason,
            hint: null,
            tests: [],
            ...extra,
        });

        const onDisk =
            sources.get(file) ??
            (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), "utf8") : null);
        if (onDisk === null) return verdict("stale", "файла больше нет — отчёт протух");
        if (source === undefined) return verdict("stale", "в отчёте нет исходника файла — сверить координаты не с чем");
        if (source !== onDisk)
            return verdict(
                "stale",
                "файл менялся после прогона Stryker'а — отчёт протух, координаты мутанта указывают не туда",
            );
        if (Date.now() - startedAt > budgetMs) return verdict("inconclusive", "кончился бюджет времени перепроверки");

        let mutated;
        try {
            mutated = applyMutant(source, mutant);
        } catch (error) {
            return verdict("stale", `координаты мутанта не ложатся на исходник: ${error.message}`);
        }

        const covering = coveringTestFiles(report, mutant).filter((test) => testFiles.includes(test));
        const stage1 = [...new Set([...covering, ...siblingTestFiles(file, testFiles)])].sort();
        const related = relatedTestFiles(file, importers).filter((test) => !stage1.includes(test));
        const stages = [
            { name: "coveredBy+соседи", tests: stage1 },
            { name: "граф импортов", tests: related },
        ];
        if (full)
            stages.push({
                name: "весь сьют",
                tests: testFiles.filter((test) => !stage1.includes(test) && !related.includes(test)),
            });
        const ran = stages.filter((stage) => stage.tests.length > 0);
        if (ran.length === 0)
            return verdict("inconclusive", "ни одного теста: ни coveredBy, ни соседних, ни импортирующих файл");

        const sandboxFile = path.join(sandbox, file);
        // Прогон без мутанта — в той же песочнице, поэтому на его время исходник
        // возвращается на место, а потом мутант вписывается обратно.
        const withoutMutant = async (fn) => {
            writeFileSync(sandboxFile, source);
            try {
                return await fn();
            } finally {
                writeFileSync(sandboxFile, mutated);
            }
        };
        writeFileSync(sandboxFile, mutated);
        let flaky = [];
        let redWithout = [];
        // Разбор упавшего прогона с мутантом: фантом — вердикт, иначе копим
        // «падало и без мутанта» и «не повторилось».
        const analyze = async (stage, run, perRun) => {
            const touched = filesOf(run.result);
            if (touched.length === 0) return null;
            const base = await withoutMutant(() => baseline(sandbox, touched, timeoutFor(touched.length)));
            if (base.error !== undefined) return verdict("inconclusive", base.error, { stage: stage.name });
            const evidence = killers(base.result, run.result);
            if (evidence.any) {
                // Повтор с мутантом только по уликам: флак фантомом не делаем.
                const suspects = [
                    ...new Set([...evidence.files, ...evidence.tests.map((key) => key.slice(0, key.indexOf(" > ")))]),
                ];
                const again = await runVitest(sandbox, suspects, { bail: false, timeoutMs: perRun, label: "confirm" });
                const confirmed = again.result === null ? null : killers(base.result, again.result);
                if (confirmed?.any) {
                    const tests = [...confirmed.tests, ...confirmed.files];
                    return verdict(
                        "phantom",
                        `убит на этапе «${stage.name}»: ${tests.slice(0, 3).join("; ")}${tests.length > 3 ? ` и ещё ${String(tests.length - 3)}` : ""}`,
                        { tests, stage: stage.name },
                    );
                }
                flaky = [...flaky, ...evidence.tests, ...evidence.files];
            }
            if (baselineIsRed(base.result))
                redWithout = [...redWithout, ...base.result.failed, ...base.result.failedFiles];
            return null;
        };
        try {
            for (const stage of ran) {
                const perRun = timeoutFor(stage.tests.length);
                const timedOut = () =>
                    verdict(
                        "timeout",
                        `vitest с мутантом не уложился в ${String(Math.round(perRun / 1000))} с на этапе «${stage.name}» (${String(stage.tests.length)} файлов)`,
                        { stage: stage.name },
                    );
                // Сначала с --bail: фантома обычно валит первый же тест, и
                // гнать сотни файлов дальше незачем.
                let run = await runVitest(sandbox, stage.tests, { bail: true, timeoutMs: perRun, label: "mutant" });
                if (run.timedOut) return timedOut();
                if (run.result !== null && filesOf(run.result).length > 0) {
                    const found = await analyze(stage, run, perRun);
                    if (found !== null) return found;
                    // Первым упал тест, который не улика (красный и без мутанта,
                    // флак), а bail оборвал остальные — догоняем этап целиком.
                    run = await runVitest(sandbox, stage.tests, {
                        bail: false,
                        timeoutMs: perRun,
                        label: "mutant-full",
                    });
                    if (run.timedOut) return timedOut();
                    if (run.result !== null) {
                        const again = await analyze(stage, run, perRun);
                        if (again !== null) return again;
                    }
                }
                // vitest упал, а тестов-виновников нет: unhandled error, падение
                // воркера, отчёт не записан. Мутант ли это — сверяем с прогоном
                // того же этапа без мутанта.
                const crashed =
                    run.result === null ||
                    (run.code !== 0 && run.result.failed.size === 0 && run.result.failedFiles.size === 0);
                if (crashed) {
                    const excerpt =
                        runtimeErrorExcerpt(run.output) ??
                        `vitest вышел кодом ${String(run.code)} без упавших тестов${run.result === null ? " и без отчёта" : ""}`;
                    const base = await withoutMutant(() => baseline(sandbox, stage.tests, perRun));
                    if (base.error !== undefined || base.crashed) {
                        return verdict(
                            "inconclusive",
                            `vitest падает и без мутанта — вердикта нет: ${base.error ?? excerpt}`,
                            { stage: stage.name },
                        );
                    }
                    return verdict("runtime-error", excerpt, { stage: stage.name });
                }
            }
        } finally {
            writeFileSync(sandboxFile, source);
        }
        const checked = ran.reduce((sum, stage) => sum + stage.tests.length, 0);
        if (redWithout.length > 0) {
            return verdict(
                "inconclusive",
                `тесты красные и без мутанта — вердикта нет: ${redWithout.slice(0, 3).join("; ")}`,
                { tests: redWithout },
            );
        }
        if (flaky.length > 0) {
            return verdict(
                "inconclusive",
                `падение с мутантом не повторилось (флак?): ${flaky.slice(0, 3).join("; ")}`,
                { tests: flaky },
            );
        }
        const hint = equivalentHint(source, mutant, siblings);
        return verdict(
            "real",
            `все подобранные тесты зелёные с мутантом (${String(checked)} файлов: ${ran.map((stage) => `${stage.name} — ${String(stage.tests.length)}`).join(", ")})`,
            { hint },
        );
    }

    const verdicts = [];
    let next = 0;
    try {
        await Promise.all(
            sandboxes.map(async (sandbox) => {
                while (next < picked.length) {
                    const candidate = picked[next++];
                    const result = await verifyOne(sandbox, candidate);
                    verdicts.push(result);
                    log(formatVerdict(result));
                }
            }),
        );
    } finally {
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.off(signal, onSignal);
        cleanup();
    }
    return verdicts.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
}

const LABELS = {
    real: "НАСТОЯЩИЙ",
    phantom: "фантом",
    "runtime-error": "RUNTIME",
    inconclusive: "БЕЗ ВЕРДИКТА",
    timeout: "ТАЙМАУТ",
    stale: "ПРОТУХ",
};

/** Строка консоли на мутанта. */
export function formatVerdict(verdict) {
    const what = `${verdict.file}:${String(verdict.line)}:${String(verdict.column)} ${verdict.mutatorName} → ${JSON.stringify(verdict.replacement).slice(0, 40)}`;
    const hint = verdict.hint ? `\n      ↳ возможно, эквивалентный: ${verdict.hint}` : "";
    const reason = verdict.reason.split("\n").slice(0, 3).join("\n      ");
    return `[${LABELS[verdict.class].padEnd(12)}] ${what}\n      ${reason}${hint}`;
}

/** Сводка по классам в одну строку. */
export function formatSummary(verdicts) {
    const counts = countClasses(verdicts);
    return Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([cls, count]) => `${cls}: ${String(count)}`)
        .join(", ");
}

/** Вердикты на диск — `verdict.json` рядом с отчётом. */
export function writeVerdictFile(reportDir, verdicts) {
    writeFileSync(
        path.join(reportDir, "verdict.json"),
        JSON.stringify(
            { counts: countClasses(verdicts), blocking: blockingVerdicts(verdicts).length, verdicts },
            null,
            2,
        ),
    );
}

function parseCli(argv) {
    const options = {
        root: null,
        reportPath: null,
        filter: null,
        limit: Infinity,
        jobs: 1,
        full: false,
        timeoutMs: null,
        budgetMs: Infinity,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const next = argv[++i];
            if (next === undefined) throw new Error(`${arg} требует значение`);
            return next;
        };
        if (arg === "--root") options.root = path.resolve(value());
        else if (arg === "--filter") options.filter = value();
        else if (arg === "--limit") options.limit = Number(value());
        else if (arg === "--jobs") options.jobs = Number(value());
        else if (arg === "--full") options.full = true;
        else if (arg === "--timeout") options.timeoutMs = Number(value()) * 1000;
        else if (arg === "--budget") options.budgetMs = Number(value()) * 60_000;
        else if (!arg.startsWith("-") && options.reportPath === null) options.reportPath = arg;
        else throw new Error(`Непонятный аргумент «${arg}»`);
    }
    return options;
}

if (import.meta.filename === process.argv[1]) {
    let options;
    try {
        options = parseCli(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exit(2);
    }
    // `--root` — проект, к которому относится отчёт (по умолчанию этот репозиторий):
    // перепроверить отчёт CI можно на распакованном снимке его коммита.
    const root = options.root ?? path.resolve(import.meta.dirname, "..");
    const reportPath = path.resolve(options.reportPath ?? path.join(root, "reports", "mutation", "mutation.json"));
    if (!existsSync(reportPath)) {
        console.error(`Отчёта нет: ${reportPath} — сначала npm run test:mutation.`);
        process.exit(2);
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const verdicts = await verifyMutants({ ...options, root, report });
    mergeVerdicts(report, verdicts);
    writeFileSync(reportPath, JSON.stringify(report));
    writeVerdictFile(path.dirname(reportPath), verdicts);
    console.log(`\nПерепроверено вживлением: ${String(verdicts.length)} (${formatSummary(verdicts) || "некого"}).`);
    process.exit(blockingVerdicts(verdicts).length > 0 || verdicts.some((verdict) => verdict.class === "real") ? 1 : 0);
}
