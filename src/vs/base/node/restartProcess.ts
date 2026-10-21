import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isSeaBinary } from "./isSea.ts";

/**
 * Перезагрузка окна заменой процесса. Наивный `spawn + exit` не годится:
 * родитель вернёт терминал шеллу, и приглашение подерётся за экран с новым
 * окном. Поэтому первый reload делает текущий процесс **супервизором**,
 * который держит терминал и синхронно ждёт ребёнка, а следующие reload'ы —
 * выход ребёнка с {@link RELOAD_EXIT_CODE}. Процессов всегда ровно два.
 * Другие аргументы (смена профиля, папки) окно оставляет супервизору в файле
 * {@link RELAUNCH_FILE_ENV}.
 */

export const RELOAD_EXIT_CODE = 77;

export const SUPERVISED_ENV = "DIODE_SUPERVISED";

export const RELAUNCH_FILE_ENV = "DIODE_RELAUNCH_FILE";

export interface IProcessSnapshot {
    readonly execPath: string;
    readonly execArgv: readonly string[];
    readonly argv: readonly string[];
    /** SEA-бинарь: скрипта в `argv[1]` нет, там сам бинарь. */
    readonly isSea: boolean;
    readonly env: NodeJS.ProcessEnv;
}

/** `null` — убит сигналом. */
export interface ISpawnResult {
    readonly status: number | null;
}

export interface IRestartHooks {
    spawnSync(
        command: string,
        args: readonly string[],
        options: { stdio: "inherit"; env: NodeJS.ProcessEnv },
    ): ISpawnResult;
    exit(code: number): never;
    /** Файл аргументов следующего окна — один на всю жизнь супервизора. */
    relaunchFilePath(): string;
    writeRelaunchFile(filePath: string, userArgs: readonly string[]): void;
    /** Читает и снимает файл; нет или битый — `null`: аргументы не менялись. */
    readRelaunchFile(filePath: string): readonly string[] | null;
}

export function restartArgs(
    snapshot: IProcessSnapshot,
    userArgs: readonly string[] = snapshot.argv.slice(2),
): string[] {
    if (snapshot.isSea) return [...userArgs];
    const mainScript = snapshot.argv[1];
    if (typeof mainScript !== "string" || mainScript === "") {
        throw new Error("reloadWindow: cannot determine main script to restart");
    }
    return [...snapshot.execArgv, mainScript, ...userArgs];
}

/** Вызывать последним: терминал, extension host и сессия к этому моменту уже отпущены. */
export function restartProcess(snapshot: IProcessSnapshot, hooks: IRestartHooks, userArgs?: readonly string[]): never {
    if (snapshot.env[SUPERVISED_ENV] === "1") {
        const relaunchFile = snapshot.env[RELAUNCH_FILE_ENV];
        if (userArgs !== undefined && relaunchFile !== undefined && relaunchFile !== "") {
            hooks.writeRelaunchFile(relaunchFile, userArgs);
        }
        return hooks.exit(RELOAD_EXIT_CODE);
    }
    const relaunchFile = hooks.relaunchFilePath();
    const env = { ...snapshot.env, [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: relaunchFile };
    let args = restartArgs(snapshot, userArgs);
    let status: number | null;
    do {
        status = hooks.spawnSync(snapshot.execPath, args, { stdio: "inherit", env }).status;
        if (status === RELOAD_EXIT_CODE) {
            const next = hooks.readRelaunchFile(relaunchFile);
            if (next !== null) args = restartArgs(snapshot, next);
        }
    } while (status === RELOAD_EXIT_CODE);
    return hooks.exit(status ?? 1);
}

export function currentProcessSnapshot(): IProcessSnapshot {
    return {
        execPath: process.execPath,
        execArgv: process.execArgv,
        argv: process.argv,
        isSea: isSeaBinary(),
        env: process.env,
    };
}

export const realRestartHooks: IRestartHooks = {
    spawnSync: (command, args, options) => spawnSync(command, [...args], options),
    exit: (code) => process.exit(code),
    relaunchFilePath: () => path.join(os.tmpdir(), `diode-relaunch-${String(process.pid)}.json`),
    writeRelaunchFile: (filePath, userArgs) => {
        // Stryker disable next-line StringLiteral: пустая кодировка у writeFileSync — та же utf-8 по умолчанию
        fs.writeFileSync(filePath, JSON.stringify(userArgs), "utf-8");
    },
    readRelaunchFile: (filePath) => {
        let content: string;
        // Stryker disable BlockStatement: без раннего выхода parseRelaunchArgs(undefined) всё равно даёт null — эквивалентный мутант
        try {
            // Stryker disable next-line StringLiteral: без кодировки readFileSync отдаёт Buffer, и JSON.parse читает его той же utf-8
            content = fs.readFileSync(filePath, "utf-8");
        } catch {
            return null;
        }
        // Stryker restore BlockStatement
        // Stryker disable next-line ObjectLiteral,BooleanLiteral: `force` — на гонку с чужим удалением между чтением и снятием; из теста не воспроизводится
        fs.rmSync(filePath, { force: true });
        return parseRelaunchArgs(content);
    },
};

export function parseRelaunchArgs(content: string): readonly string[] | null {
    let parsed: unknown;
    // Stryker disable BlockStatement: без раннего выхода `parsed` остаётся undefined и отсеивается Array.isArray — эквивалентный мутант
    try {
        parsed = JSON.parse(content);
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return parsed;
}
