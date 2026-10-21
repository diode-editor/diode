import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isSeaBinary } from "./isSea.ts";

/**
 * Window reload by process replacement. A naive `spawn + exit` doesn't work:
 * the parent returns the terminal to the shell, and the prompt fights the new
 * window for the screen. So the first reload turns the current process into a **supervisor**
 * that holds the terminal and synchronously waits for the child, and subsequent reloads are
 * the child exiting with {@link RELOAD_EXIT_CODE}. There are always exactly two processes.
 * Other arguments (profile or folder change) the window leaves to the supervisor in the
 * {@link RELAUNCH_FILE_ENV} file.
 */

export const RELOAD_EXIT_CODE = 77;

export const SUPERVISED_ENV = "DIODE_SUPERVISED";

export const RELAUNCH_FILE_ENV = "DIODE_RELAUNCH_FILE";

export interface IProcessSnapshot {
    readonly execPath: string;
    readonly execArgv: readonly string[];
    readonly argv: readonly string[];
    /** SEA binary: `argv[1]` holds the binary itself, not a script. */
    readonly isSea: boolean;
    readonly env: NodeJS.ProcessEnv;
}

/** `null` means killed by a signal. */
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
    /** The next window's arguments file, one for the supervisor's whole life. */
    relaunchFilePath(): string;
    writeRelaunchFile(filePath: string, userArgs: readonly string[]): void;
    /** Reads and removes the file; missing or broken gives `null`: the arguments didn't change. */
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

/** Call last: the terminal, extension host and session are already released by then. */
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
        // Stryker disable next-line StringLiteral: an empty encoding in writeFileSync is the same default utf-8
        fs.writeFileSync(filePath, JSON.stringify(userArgs), "utf-8");
    },
    readRelaunchFile: (filePath) => {
        let content: string;
        // Stryker disable BlockStatement: without the early return parseRelaunchArgs(undefined) still gives null, an equivalent mutant
        try {
            // Stryker disable next-line StringLiteral: without an encoding readFileSync returns a Buffer, and JSON.parse reads it as the same utf-8
            content = fs.readFileSync(filePath, "utf-8");
        } catch {
            return null;
        }
        // Stryker restore BlockStatement
        // Stryker disable next-line ObjectLiteral,BooleanLiteral: `force` covers a race with someone else deleting between read and removal; not reproducible from a test
        fs.rmSync(filePath, { force: true });
        return parseRelaunchArgs(content);
    },
};

export function parseRelaunchArgs(content: string): readonly string[] | null {
    let parsed: unknown;
    // Stryker disable BlockStatement: without the early return `parsed` stays undefined and is filtered out by Array.isArray, an equivalent mutant
    try {
        parsed = JSON.parse(content);
    } catch {
        return null;
    }
    // Stryker restore BlockStatement
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) return null;
    return parsed;
}
