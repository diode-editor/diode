/**
 * Фикстуры бенча открытия файла: матрица размеров и генератор файлов.
 * Общие для отчёта (`benchOpen.ts`) и перф-гейта (`startupBudget.bench.ts`).
 */

import { createWriteStream } from "node:fs";
import { join } from "node:path";

export interface SizeSpec {
    readonly key: string;
    readonly kind: "ts" | "log";
    /** Для kind=ts — число строк; для kind=log — целевой размер в байтах. */
    readonly amount: number;
    /** Замеряемых прогонов (плюс один прогревочный, в статистику не идёт). */
    readonly runs: number;
    readonly timeoutMs: number;
}

export const MiB = 1024 * 1024;

export const SIZES: readonly SizeSpec[] = [
    { key: "small", kind: "ts", amount: 100, runs: 11, timeoutMs: 30_000 },
    { key: "medium", kind: "ts", amount: 2_000, runs: 11, timeoutMs: 30_000 },
    { key: "large", kind: "ts", amount: 20_000, runs: 7, timeoutMs: 60_000 },
    { key: "xlarge", kind: "ts", amount: 200_000, runs: 5, timeoutMs: 120_000 },
    { key: "log500m", kind: "log", amount: 500 * MiB, runs: 3, timeoutMs: 300_000 },
];

// Первая строка ts-фикстуры: `const benchMarker = 42; // diode-bench`.
// Контент — маркер виден; подсветка — ячейка `c` слова `const` покрашена
// цветом keyword из darkPlus (дефолтная тема; тот же ассерт в sea-startup).
export const TS_MARKER = "benchMarker";
export const TS_FIRST_LINE = `const ${TS_MARKER} = 42; // diode-bench`;
// Первая строка лога; `.log` — plaintext, подсветки не существует.
export const LOG_MARKER = "diode-bench-log-start";
export const LOG_FIRST_LINE = `2026-01-01T00:00:00.000Z INFO ${LOG_MARKER}`;

/** Сгенерированный файл: путь, число строк и текст любой строки (для предикатов нагрузки). */
export interface OpenFixture {
    readonly key: string;
    readonly kind: "ts" | "log";
    readonly path: string;
    readonly lines: number;
    /** Слово-маркер первой строки: по нему бенч видит текст на экране. */
    readonly marker: string;
    lineAt(index: number): string;
}

function tsLine(i: number): string {
    return i === 0
        ? TS_FIRST_LINE
        : `export const value${String(i)} = ${String(i)}; // sample line with a comment tail`;
}

function logLine(i: number): string {
    if (i === 0) return LOG_FIRST_LINE;
    return `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i % 1000).padStart(3, "0")}Z INFO worker[${String(i % 8)}] request ${String(i)} handled in ${String(i % 90)}ms path=/api/v1/items/${String(i)}`;
}

/** Пишет файл блоками через стрим — 500 МБ одной строкой не собрать. */
async function writeLines(path: string, lines: () => Generator<string>): Promise<void> {
    const stream = createWriteStream(path);
    let block: string[] = [];
    for (const line of lines()) {
        block.push(line);
        if (block.length >= 10_000) {
            const flushed = block.join("\n") + "\n";
            block = [];
            if (!stream.write(flushed)) {
                await new Promise((resolve) => stream.once("drain", resolve));
            }
        }
    }
    if (block.length > 0) stream.write(block.join("\n") + "\n");
    await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on("error", reject);
    });
}

export async function generateFixture(dir: string, spec: SizeSpec): Promise<OpenFixture> {
    if (spec.kind === "ts") {
        const path = join(dir, `${spec.key}.ts`);
        await writeLines(path, function* () {
            for (let i = 0; i < spec.amount; i++) yield tsLine(i);
        });
        return { key: spec.key, kind: "ts", path, lines: spec.amount, marker: TS_MARKER, lineAt: tsLine };
    }
    const path = join(dir, `${spec.key}.log`);
    const approxLine = logLine(1_234_567).length + 1;
    const lineCount = Math.ceil(spec.amount / approxLine);
    await writeLines(path, function* () {
        for (let i = 0; i < lineCount; i++) yield logLine(i);
    });
    return { key: spec.key, kind: "log", path, lines: lineCount, marker: LOG_MARKER, lineAt: logLine };
}
