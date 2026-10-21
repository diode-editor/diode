/**
 * Пол процесса тем же путём, что и замер: спаун через node-pty с теми же cols/rows и env, до
 * первого чанка stdout (или до выхода). `spawnSync` с пайпами — другой путь и другая цена,
 * вычитать его из PTY-замера нечестно.
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

export const NODE_FLOOR_ARGS: readonly string[] = ["-e", ""];
export const NODE_VERSION_ARGS: readonly string[] = ["--version"];
export const BINARY_FLOOR_ARGS: readonly string[] = ["--version"];
