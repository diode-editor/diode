/**
 * Отчёт бенча открытия файла: агрегация прогонов в статистику и рендер в
 * Markdown (страница docs/public/BENCH-OPEN.md, перезаписывается `bench.yml`).
 */

import type { OpenFixture } from "./openFixtures.ts";
import { MiB } from "./openFixtures.ts";
import type { OpenRunResult, WorkloadStepKey } from "./openMeasure.ts";
import { WORKLOAD_STEPS } from "./openMeasure.ts";
import type { FloorResult } from "./ptyFloor.ts";
import { MILESTONES } from "./startupLadder.ts";
import { NOISY_IQR_RATIO, type Stats, statsOf } from "./stats.ts";

export interface SizeReport {
    readonly key: string;
    readonly kind: string;
    readonly fixtureBytes: number;
    readonly fixtureLines: number;
    readonly runs: readonly OpenRunResult[];
    /** До текста, мс от спауна (чёрный ящик). */
    readonly content: Stats | null;
    readonly highlight: Stats | null;
    /** Наших мс: до текста − пол node (главная цифра). */
    readonly ours: Stats | null;
    /** До текста − пол бинаря (`diode --version`): кухня старта без парса бандла. */
    readonly overBinary: Stats | null;
    readonly peakRss: Stats | null;
    /** Лестница вех, веха → статистика по прогонам (мс от спауна). */
    readonly ladder: Readonly<Record<string, Stats | null>>;
    /** Расхождение чёрного и белого ящика: до текста (PTY) − кадр с текстом (трасса). */
    readonly boxGap: Stats | null;
    readonly workload: Readonly<Record<WorkloadStepKey, Stats | null>>;
    /** Прогоны, где нагрузка не дошла до конца: «crash (signal 9)», «failed: …». */
    readonly workloadFailures: readonly string[];
}

export interface ReportEnv {
    readonly cpu: string;
    readonly cores: number;
    readonly memGb: number;
    readonly platform: string;
    /** Условия прогона: CI shared runner или локальная машина разработчика (+ подпись). */
    readonly conditions: string;
    readonly ci: boolean;
}

export interface FullReport {
    readonly generatedAt: string;
    readonly commit: string;
    readonly binaryVersion: string;
    readonly env: ReportEnv;
    readonly floors: {
        /** `diode --version`: рантайм + парс SEA-бандла. */
        readonly binary: FloorResult;
        /** `node -e ""`: минимальный процесс, исполняющий JS, — от него считаем «наших мс». */
        readonly node: FloorResult;
        /** `node --version`: для справки — отвечает до подъёма V8, полом не служит. */
        readonly nodeVersion: FloorResult;
    };
    readonly sizes: readonly SizeReport[];
}

export function summarizeSize(
    fixture: OpenFixture,
    fixtureBytes: number,
    runs: readonly OpenRunResult[],
    floors: FullReport["floors"],
): SizeReport {
    const measured = runs.filter((r) => !r.warmup && r.outcome === "ok");
    const ladder: Record<string, Stats | null> = {};
    for (const m of MILESTONES) {
        ladder[m.key] = statsOf(measured.map((r) => r.ladder?.[m.key]));
    }
    const workload = {} as Record<WorkloadStepKey, Stats | null>;
    for (const step of WORKLOAD_STEPS) {
        workload[step.key] = statsOf(
            measured.map((r) => r.workload.find((w) => w.key === step.key)?.latencyMs ?? null),
        );
    }
    const contentValues = measured.map((r) => r.contentMs);
    return {
        key: fixture.key,
        kind: fixture.kind,
        fixtureBytes,
        fixtureLines: fixture.lines,
        runs,
        content: statsOf(contentValues),
        highlight: statsOf(measured.map((r) => r.highlightMs)),
        ours: statsOf(contentValues.map((v) => (v === null ? null : v - floors.node.medianMs))),
        overBinary: statsOf(contentValues.map((v) => (v === null ? null : v - floors.binary.medianMs))),
        peakRss: statsOf(measured.map((r) => r.peakRssBytes)),
        ladder,
        boxGap: statsOf(
            measured.map((r) => {
                const frame = r.ladder?.frameWithText;
                return r.contentMs === null || frame === null || frame === undefined ? null : r.contentMs - frame;
            }),
        ),
        workload,
        workloadFailures: measured
            .filter((r) => r.workloadOutcome !== "ok" && r.workloadOutcome !== "skipped")
            .map((r) =>
                r.workloadOutcome === "crash"
                    ? `crash${r.signal !== null ? ` (signal ${String(r.signal)})` : ""}`
                    : `failed${r.workloadError !== null ? `: ${r.workloadError}` : ""}`,
            ),
    };
}

// ── Форматирование ───────────────────────────────────────────────────────────

export function formatMs(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : `${String(Math.round(value))} мс`;
}

export function formatBytes(bytes: number): string {
    if (bytes >= MiB) return `${(bytes / MiB).toFixed(bytes >= 100 * MiB ? 0 : 1)} МБ`;
    return `${(bytes / 1024).toFixed(1)} КБ`;
}

function formatIqr(s: Stats | null): string {
    if (s === null) return "—";
    return `${String(Math.round(s.iqr))} мс${s.noisy ? " ⚠ шумно" : ""}`;
}

function medianCell(s: Stats | null | undefined): string {
    return formatMs(s?.median);
}

function outcomeNote(size: SizeReport): string {
    // Провалы считаем по всем прогонам, включая прогревочный: краш на
    // прогреве — это не шум, а сам результат («файл не открывается»).
    const failed = size.runs.filter((r) => r.outcome !== "ok");
    if (failed.length === 0) return "";
    return ` ${failed
        .map((r) => (r.signal !== null ? `${r.outcome} (signal ${String(r.signal)})` : r.outcome))
        .join(", ")}`;
}

export function renderMarkdown(report: FullReport): string {
    const lines: string[] = [];
    const noisyPercent = String(Math.round(NOISY_IQR_RATIO * 100));
    lines.push("# Бенчмарк открытия файла");
    lines.push("");
    lines.push(`- Снято: ${report.generatedAt}, коммит \`${report.commit}\`, diode ${report.binaryVersion}`);
    lines.push(
        `- Машина: ${report.env.cpu} (${String(report.env.cores)} cores, ${String(report.env.memGb)} GB), ${report.env.platform}`,
    );
    lines.push(`- Условия: ${report.env.conditions}`);
    lines.push(
        `- Пол node (\`node -e ""\` через PTY, median): ${formatMs(report.floors.node.medianMs)}; ` +
            `пол бинаря (\`diode --version\` через PTY, median): ${formatMs(report.floors.binary.medianMs)}; ` +
            `для справки \`node --version\`: ${formatMs(report.floors.nodeVersion.medianMs)} (отвечает до подъёма V8)`,
    );
    lines.push("");

    lines.push("## От пола");
    lines.push("");
    lines.push(
        "Главная цифра — **наших мс**: до текста минус пол node (столько стоит всё наше поверх " +
            "рантайма). «Над полом бинаря» вычитает ещё и парс SEA-бандла (`diode --version`), " +
            "оставляя кухню воркбенча. Медианы по прогонам; IQR — межквартильный размах, " +
            `при IQR > ${noisyPercent} % медианы строка помечена «шумно».`,
    );
    lines.push("");
    lines.push(
        "| файл | размер | строк | наших мс | над полом бинаря | до текста | до подсветки | IQR (до текста) | peak RSS | прогонов |",
    );
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const size of report.sizes) {
        const measured = size.runs.filter((r) => !r.warmup && r.outcome === "ok");
        const cells = [
            `\`${size.key}\``,
            formatBytes(size.fixtureBytes),
            String(size.fixtureLines),
            `**${medianCell(size.ours)}**`,
            medianCell(size.overBinary),
            medianCell(size.content) + outcomeNote(size),
            size.kind === "log" ? "— (plaintext)" : medianCell(size.highlight),
            formatIqr(size.content),
            size.peakRss === null ? "—" : formatBytes(size.peakRss.median),
            String(measured.length),
        ];
        lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");

    lines.push("## Лестница вех (белый ящик)");
    lines.push("");
    lines.push(
        "Вехи `performance.mark` внутри процесса (`DIODE_STARTUP_TRACE`), median мс от спауна. " +
            "Две последние строки — чёрный ящик (тот же прогон, по байтам на PTY) и расхождение " +
            "«до текста − кадр с текстом»: цена доставки кадра через PTY и парсер бенча.",
    );
    lines.push("");
    lines.push(`| веха | ${report.sizes.map((s) => `\`${s.key}\``).join(" | ")} |`);
    lines.push(`| --- | ${report.sizes.map(() => "---:").join(" | ")} |`);
    for (const m of MILESTONES) {
        lines.push(`| ${m.label} | ${report.sizes.map((s) => medianCell(s.ladder[m.key])).join(" | ")} |`);
    }
    lines.push(`| до текста (чёрный ящик) | ${report.sizes.map((s) => medianCell(s.content)).join(" | ")} |`);
    lines.push(`| до подсветки (чёрный ящик) | ${report.sizes.map((s) => medianCell(s.highlight)).join(" | ")} |`);
    lines.push(`| расхождение чёрный − белый (текст) | ${report.sizes.map((s) => medianCell(s.boxGap)).join(" | ")} |`);
    lines.push("");

    lines.push("## Нагрузка после открытия");
    lines.push("");
    lines.push(
        "Латентность клавиши: от записи в PTY до кадра, в котором изменение видно на экране " +
            "(median мс). Каретка в середине файла; поиск — одно слово одним paste-событием.",
    );
    lines.push("");
    lines.push(`| файл | ${WORKLOAD_STEPS.map((s) => s.label).join(" | ")} |`);
    lines.push(`| --- | ${WORKLOAD_STEPS.map(() => "---:").join(" | ")} |`);
    for (const size of report.sizes) {
        const note = size.workloadFailures.length === 0 ? "" : ` ${[...new Set(size.workloadFailures)].join(", ")}`;
        lines.push(
            `| \`${size.key}\`${note} | ${WORKLOAD_STEPS.map((s) => medianCell(size.workload[s.key])).join(" | ")} |`,
        );
    }
    lines.push("");

    lines.push(
        "Методика: SEA-бинарь запускается в PTY (120×32) в герметичном окружении " +
            "(свой user-data-dir и HOME); отсчёт — от спауна процесса; момент появления " +
            "текста/подсветки восстанавливается по таймстемпам чанков stdout. " +
            "Полы node и бинаря сняты в том же прогоне тем же способом (спаун через PTY, " +
            'до первого чанка вывода): пол node — `node -e ""`, минимальный процесс с полным ' +
            "бутстрапом V8 (`node --version` отвечает до подъёма V8 и полом рантайма быть не может); " +
            "пол бинаря — `diode --version`, то есть плюс парс SEA-бандла. " +
            "«До подсветки» — первый кадр, где ключевое слово " +
            "раскрашено темой. Peak RSS — `VmHWM` процесса редактора за весь прогон (старт + нагрузка). " +
            "LSP в замер не входит. Первый прогон каждого размера — прогревочный, в статистике не участвует.",
    );
    lines.push("");
    return lines.join("\n");
}
