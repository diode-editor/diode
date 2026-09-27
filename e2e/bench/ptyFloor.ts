/**
 * Пол процесса тем же путём, что и замер: `<cmd> <args>` спаунится через
 * node-pty с теми же cols/rows и env, время — от спауна до первого чанка stdout
 * (та же точка, что «до текста» у редактора: байты пришли на PTY), а если
 * вывода нет — до выхода. Раньше пол снимался `spawnSync` с пайпами — другой
 * путь (без pty/termios/alt-screen), другая цена, и вычитать его из PTY-замера
 * было нечестно.
 *
 * Полы, которые снимает бенч:
 * - `node -e ""` — пол node: минимальный процесс, который вообще исполняет JS
 *   (полный бутстрап V8 и node). Главная цифра отчёта считается от него.
 * - `node --version` — для справки: node отвечает на него ДО подъёма V8
 *   (единицы мс), поэтому полом рантайма он служить не может.
 * - `diode --version` — пол бинаря: + парс и выполнение SEA-бандла до CLI.
 */

import * as pty from "node-pty";
import { performance } from "node:perf_hooks";

import { hermeticSpawnEnv } from "../helpers/hermeticEnv.ts";

import { median } from "./stats.ts";

export interface FloorOptions {
    readonly cols: number;
    readonly rows: number;
    /** Замеряемых прогонов; первый (прогрев FS-кеша) в статистику не идёт. */
    readonly runs: number;
    readonly env?: Readonly<Record<string, string>>;
}

/** Один спаун `<cmd> <args>` в PTY: мс до первого чанка вывода (или до выхода, если вывода не было). */
export function measureFloorOnce(cmd: string, args: readonly string[], options: FloorOptions): Promise<number> {
    return new Promise((resolve, reject) => {
        const env = hermeticSpawnEnv(options.env);
        const t0 = performance.now();
        const term = pty.spawn(cmd, [...args], {
            name: "xterm-256color",
            cols: options.cols,
            rows: options.rows,
            env,
        });
        let firstData: number | null = null;
        term.onData(() => {
            firstData ??= performance.now() - t0;
        });
        term.onExit(({ exitCode }) => {
            if (exitCode !== 0) {
                reject(new Error(`${cmd} ${args.join(" ")} exited ${String(exitCode)}`));
                return;
            }
            resolve(firstData ?? performance.now() - t0);
        });
    });
}

export interface FloorResult {
    /** Что спаунили — чтобы отчёт и JSON были самоописательными. */
    readonly command: string;
    readonly medianMs: number;
    readonly samplesMs: readonly number[];
}

/** Медиана `<cmd> <args>` через PTY — пол, ниже которого старт не опустится. */
export async function measureFloorPty(
    cmd: string,
    args: readonly string[],
    options: FloorOptions,
): Promise<FloorResult> {
    const samplesMs: number[] = [];
    for (let i = 0; i <= options.runs; i++) {
        const elapsed = await measureFloorOnce(cmd, args, options);
        if (i > 0) samplesMs.push(elapsed);
    }
    return { command: [cmd, ...args].join(" "), medianMs: median(samplesMs), samplesMs };
}

/** Аргументы полов (см. шапку модуля). */
export const NODE_FLOOR_ARGS: readonly string[] = ["-e", ""];
export const NODE_VERSION_ARGS: readonly string[] = ["--version"];
export const BINARY_FLOOR_ARGS: readonly string[] = ["--version"];
