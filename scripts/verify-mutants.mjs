#!/usr/bin/env node
/**
 * Перепроверка выживших мутантов вживлением — процедура из
 * docs/TODO/MutationGateFlake.md.
 *
 * Гейт мутаций в этом проекте записывает в Survived мутантов, которых
 * существующие тесты убивают: Stryker подбирает для прогона не те тесты
 * (`vitest --related`) или теряет результат упавшего прогона. Поэтому прежде чем
 * чинить «выжившего», его надо внести в исходник РОВНО так, как это делал Stryker
 * (`location.start/end` + `replacement` из отчёта), и прогнать тесты его файла:
 *
 *   - тесты краснеют → это ФАНТОМ гейта, чинить нечего и глушить нельзя;
 *   - тесты зелёные  → дырка настоящая: нужен тест либо `Stryker disable` с причиной.
 *
 * Источник списка — `reports/stryker-incremental.json` последнего прогона.
 *
 * Использование:
 *   node scripts/verify-mutants.mjs [--filter <подстрока пути>] [--limit N]
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const reportPath = path.join(repoRoot, "reports", "stryker-incremental.json");

const argv = process.argv.slice(2);
const filter = argv.includes("--filter") ? argv[argv.indexOf("--filter") + 1] : null;
const limit = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : Infinity;

/** Тестовые файлы рядом с исходником: `a.ts` → `a*.test.ts` в том же каталоге. */
function testsFor(sourcePath) {
    const dir = path.dirname(sourcePath);
    const base = path.basename(sourcePath, ".ts");
    const listing = spawnSync("git", ["ls-files", `${dir}/${base}*.test.ts`], { cwd: repoRoot, encoding: "utf8" });
    const own = listing.stdout.split("\n").filter(Boolean);
    if (own.length > 0) return own;
    // Компоненты и сервисы проверяются ещё и интеграционным сьютом workbench.
    const fallback = spawnSync("git", ["ls-files", "src/vs/workbench/browser/workbench.notifications.test.ts"], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    return fallback.stdout.split("\n").filter(Boolean);
}

/** Смещение в тексте по (line, column) отчёта Stryker (1-based, column тоже). */
function offsetOf(text, position) {
    let offset = 0;
    for (let line = 1; line < position.line; line++) {
        const next = text.indexOf("\n", offset);
        if (next < 0) throw new Error(`строки ${String(position.line)} нет в файле`);
        offset = next + 1;
    }
    return offset + position.column - 1;
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const survivors = [];
for (const [file, entry] of Object.entries(report.files)) {
    if (filter !== null && !file.includes(filter)) continue;
    for (const mutant of entry.mutants) {
        if (mutant.status !== "Survived") continue;
        survivors.push({ file, mutant });
    }
}
survivors.sort((a, b) => a.file.localeCompare(b.file) || a.mutant.location.start.line - b.mutant.location.start.line);

process.stdout.write(`Выживших в отчёте: ${String(survivors.length)}\n\n`);

let phantoms = 0;
let real = 0;
for (const { file, mutant } of survivors.slice(0, limit)) {
    const full = path.join(repoRoot, file);
    const original = readFileSync(full, "utf8");
    const from = offsetOf(original, mutant.location.start);
    const to = offsetOf(original, mutant.location.end);
    const patched = original.slice(0, from) + (mutant.replacement ?? "") + original.slice(to);
    const tests = testsFor(file);
    const where = `${file}:${String(mutant.location.start.line)}:${String(mutant.location.start.column)}`;
    if (tests.length === 0) {
        process.stdout.write(`[?] ${where} ${mutant.mutatorName}: тестовых файлов рядом не нашлось\n`);
        continue;
    }
    writeFileSync(full, patched);
    try {
        const run = spawnSync("npx", ["vitest", "run", ...tests], { cwd: repoRoot, encoding: "utf8", timeout: 600_000 });
        const killed = run.status !== 0;
        if (killed) phantoms++;
        else real++;
        process.stdout.write(`[${killed ? "ФАНТОМ" : "ЖИВ   "}] ${where} ${mutant.mutatorName} → ${JSON.stringify(mutant.replacement ?? "").slice(0, 40)}\n`);
    } finally {
        writeFileSync(full, original);
    }
}

process.stdout.write(`\nфантомов гейта: ${String(phantoms)}, настоящих дыр: ${String(real)}\n`);
