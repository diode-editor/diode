/**
 * Бенчмарк открытия файла — «линейка» плана docs/TODO/OpenPerformance.md.
 *
 * Чёрный ящик: настоящий SEA-бинарь через PTY (тот же путь, что у пользователя),
 * таймстемп каждого чанка stdout, момент появления текста/подсветки — реплеем
 * чанков. Белый ящик: трасса вех `performance.mark` того же процесса
 * (`DIODE_STARTUP_TRACE`), лестница печатается рядом — расхождение между ними
 * само по себе находка. Отсчёт главной цифры — от пола node, снятого тем же
 * способом (PTY). После открытия — нагрузка (правки, Ctrl+End, поиск) с
 * латентностью клавиши и пиковый RSS процесса.
 *
 * LSP в замер не входит: замер заканчивается на TextMate-подсветке, language
 * server приезжает асинхронно позже.
 *
 * Запуск: `npm run bench:open [-- --sizes=small,log500m --runs=3 --json=out.json --md=out.md --label="от сети, фон пуст"]`
 * Бинарь собирается лениво (`getBinaryPath` → `npm run build:sea`), либо
 * передаётся готовый через env `DIODE_E2E_BINARY`. Тяжёлый прогон — под лизу
 * (скилл heavy-run).
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { dirname, join } from "node:path";

import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";

import { generateFixture, MiB, SIZES, type SizeSpec } from "./openFixtures.ts";
import { COLS, measureOpenOnce, type OpenRunResult, ROWS } from "./openMeasure.ts";
import { formatMs, type FullReport, renderMarkdown, type SizeReport, summarizeSize } from "./openReport.ts";
import { BINARY_FLOOR_ARGS, measureFloorPty, NODE_FLOOR_ARGS, NODE_VERSION_ARGS } from "./ptyFloor.ts";

// ── CLI ──────────────────────────────────────────────────────────────────────

interface CliOptions {
    sizes: readonly SizeSpec[];
    runsOverride: number | null;
    jsonPath: string | null;
    mdPath: string | null;
    /** Подпись условий локального прогона (машина, питание, фон). */
    label: string | null;
    workload: boolean;
}

export function parseCli(argv: readonly string[]): CliOptions {
    const options: CliOptions = {
        sizes: SIZES,
        runsOverride: null,
        jsonPath: null,
        mdPath: null,
        label: null,
        workload: true,
    };
    for (const arg of argv) {
        if (arg.startsWith("--sizes=")) {
            const keys = arg.slice("--sizes=".length).split(",");
            const picked = SIZES.filter((s) => keys.includes(s.key));
            if (picked.length !== keys.length) {
                const known = SIZES.map((s) => s.key).join(", ");
                throw new Error(`--sizes: неизвестный ключ среди "${keys.join(",")}" (известные: ${known})`);
            }
            options.sizes = picked;
        } else if (arg.startsWith("--runs=")) {
            options.runsOverride = Number(arg.slice("--runs=".length));
            if (!Number.isInteger(options.runsOverride) || options.runsOverride < 1) {
                throw new Error(`--runs: ожидается целое ≥ 1, получено "${arg}"`);
            }
        } else if (arg.startsWith("--json=")) {
            options.jsonPath = arg.slice("--json=".length);
        } else if (arg.startsWith("--md=")) {
            options.mdPath = arg.slice("--md=".length);
        } else if (arg.startsWith("--label=")) {
            options.label = arg.slice("--label=".length);
        } else if (arg === "--no-workload") {
            options.workload = false;
        } else {
            throw new Error(`неизвестный аргумент: ${arg}`);
        }
    }
    return options;
}

/** Строка условий в шапке: shared-раннер CI или локальная машина разработчика. */
export function describeConditions(env: Readonly<Record<string, string | undefined>>, label: string | null): string {
    const ci = env.GITHUB_ACTIONS === "true" || env.CI === "true" || env.CI === "1";
    if (ci) return `CI, shared runner (GitHub Actions)${label === null ? "" : `; ${label}`}`;
    return `локальный прогон на машине разработчика${label === null ? "" : `: ${label}`}`;
}

async function main(): Promise<void> {
    const cli = parseCli(process.argv.slice(2));
    const binary = await getBinaryPath();
    const versionRun = spawnSync(binary, ["--version"], { stdio: "pipe", encoding: "utf8" });
    const binaryVersion = (versionRun.stdout ?? "").trim();

    const commitRun = spawnSync("git", ["rev-parse", "--short", "HEAD"], { stdio: "pipe", encoding: "utf8" });
    const commit = process.env.GITHUB_SHA?.slice(0, 12) ?? (commitRun.stdout ?? "unknown").trim();

    console.error("[bench] пол процесса (PTY)…");
    const floorOptions = { cols: COLS, rows: ROWS, runs: 7 };
    const floors = {
        binary: await measureFloorPty(binary, BINARY_FLOOR_ARGS, floorOptions),
        node: await measureFloorPty(process.execPath, NODE_FLOOR_ARGS, floorOptions),
        nodeVersion: await measureFloorPty(process.execPath, NODE_VERSION_ARGS, floorOptions),
    };
    console.error(
        `[bench] пол node=${formatMs(floors.node.medianMs)} (node --version=${formatMs(floors.nodeVersion.medianMs)}) ` +
            `бинарь=${formatMs(floors.binary.medianMs)}`,
    );

    const fixtureDir = mkdtempSync(join(os.tmpdir(), "diode-bench-"));
    const sizes: SizeReport[] = [];
    try {
        for (const spec of cli.sizes) {
            console.error(`[bench] фикстура ${spec.key}…`);
            const fixture = await generateFixture(fixtureDir, spec);
            const fixtureBytes = statSync(fixture.path).size;
            const runs = cli.runsOverride ?? spec.runs;

            const results: OpenRunResult[] = [];
            for (let i = 0; i <= runs; i++) {
                const warmup = i === 0;
                const result = await measureOpenOnce({
                    binary,
                    fixture,
                    timeoutMs: spec.timeoutMs,
                    warmup,
                    workload: cli.workload,
                });
                results.push(result);
                const keys =
                    result.workload.length === 0
                        ? ""
                        : ` keys=[${result.workload.map((w) => `${w.key}=${formatMs(w.latencyMs)}`).join(" ")}]`;
                console.error(
                    `[bench] ${spec.key} #${String(i)}${warmup ? " (warmup)" : ""}: ${result.outcome}` +
                        (result.outcome === "ok"
                            ? ` content=${formatMs(result.contentMs)} highlight=${formatMs(result.highlightMs)}` +
                              ` frameWithText=${formatMs(result.ladder?.frameWithText)}` +
                              ` rss=${result.peakRssBytes === null ? "—" : `${String(Math.round(result.peakRssBytes / MiB))} МБ`}` +
                              keys
                            : ` exit=${String(result.exitCode)} signal=${String(result.signal)}`),
                );
                // Смысла жечь оставшиеся прогоны нет: исход детерминированно плохой.
                if (result.outcome === "crash") break;
            }
            sizes.push(summarizeSize(fixture, fixtureBytes, results, floors));
        }
    } finally {
        removeTempDir(fixtureDir);
    }

    const report: FullReport = {
        generatedAt: new Date().toISOString(),
        commit,
        binaryVersion,
        env: {
            cpu: os.cpus()[0]?.model ?? "unknown",
            cores: os.cpus().length,
            memGb: Math.round(os.totalmem() / (1024 * MiB)),
            platform: `${os.platform()} ${os.release()}`,
            conditions: describeConditions(process.env, cli.label),
            ci: process.env.GITHUB_ACTIONS === "true",
        },
        floors,
        sizes,
    };

    const markdown = renderMarkdown(report);
    if (cli.jsonPath !== null) {
        mkdirSync(dirname(cli.jsonPath), { recursive: true });
        writeFileSync(cli.jsonPath, JSON.stringify(report, null, 2) + "\n");
    }
    if (cli.mdPath !== null) {
        mkdirSync(dirname(cli.mdPath), { recursive: true });
        writeFileSync(cli.mdPath, markdown);
    }
    console.log(markdown);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
