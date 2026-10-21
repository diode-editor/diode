import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { IProcessSnapshot, IRestartHooks, ISpawnResult } from "./restartProcess.ts";
import {
    currentProcessSnapshot,
    parseRelaunchArgs,
    realRestartHooks,
    RELAUNCH_FILE_ENV,
    RELOAD_EXIT_CODE,
    restartArgs,
    restartProcess,
    SUPERVISED_ENV,
} from "./restartProcess.ts";

function devSnapshot(overrides: Partial<IProcessSnapshot> = {}): IProcessSnapshot {
    return {
        execPath: "/usr/bin/node",
        execArgv: ["--import", "tsx"],
        argv: ["/usr/bin/node", "/repo/src/vs/diode/main.ts", "/work", "--headless=80x24"],
        isSea: false,
        env: { HOME: "/home/user" },
        ...overrides,
    };
}

/** Snapshot of a SEA binary: `argv[1]` is the binary itself, not a script. */
function seaSnapshot(overrides: Partial<IProcessSnapshot> = {}): IProcessSnapshot {
    return devSnapshot({
        execPath: "/opt/diode",
        execArgv: [],
        argv: ["/opt/diode", "/opt/diode", "/work", "--headless=80x24"],
        isSea: true,
        ...overrides,
    });
}

/** A stub error instead of `process.exit`: the hook must not return control. */
class ExitCalled extends Error {
    public constructor(public readonly code: number) {
        super(`exit(${String(code)})`);
    }
}

interface IRecordedSpawn {
    command: string;
    args: readonly string[];
    options: { stdio: "inherit"; env: NodeJS.ProcessEnv };
}

/**
 * Hooks that record calls; `statuses` are the children's exit codes in order,
 * `relaunches` is what the "window" left in the arguments file before each exit
 * (`null` means nothing), in restart order.
 */
function createHooks(
    statuses: readonly (number | null)[],
    relaunches: readonly (readonly string[] | null)[] = [],
): {
    hooks: IRestartHooks;
    spawns: IRecordedSpawn[];
    written: { filePath: string; userArgs: readonly string[] }[];
    reads: string[];
} {
    const spawns: IRecordedSpawn[] = [];
    const written: { filePath: string; userArgs: readonly string[] }[] = [];
    const reads: string[] = [];
    let call = 0;
    let relaunch = 0;
    const hooks: IRestartHooks = {
        spawnSync: (command, args, options): ISpawnResult => {
            spawns.push({ command, args, options });
            const status = statuses[call++];
            return { status: status ?? null };
        },
        exit: (code) => {
            throw new ExitCalled(code);
        },
        relaunchFilePath: () => "/tmp/relaunch.json",
        writeRelaunchFile: (filePath, userArgs) => {
            written.push({ filePath, userArgs });
        },
        readRelaunchFile: (filePath) => {
            reads.push(filePath);
            return relaunches[relaunch++] ?? null;
        },
    };
    return { hooks, spawns, written, reads };
}

function runRestart(snapshot: IProcessSnapshot, hooks: IRestartHooks, userArgs?: readonly string[]): number {
    try {
        restartProcess(snapshot, hooks, userArgs);
    } catch (error) {
        if (error instanceof ExitCalled) return error.code;
        throw error;
    }
    throw new Error("restartProcess returned, but it must never return");
}

describe("restartArgs", () => {
    it("dev: node flags and the main script come before user arguments", () => {
        expect(restartArgs(devSnapshot())).toEqual([
            "--import",
            "tsx",
            "/repo/src/vs/diode/main.ts",
            "/work",
            "--headless=80x24",
        ]);
    });

    it("SEA: user arguments only; the program is execPath itself", () => {
        expect(restartArgs(seaSnapshot())).toEqual(["/work", "--headless=80x24"]);
    });

    it("explicit user arguments replace argv[2..] entirely", () => {
        expect(restartArgs(devSnapshot(), ["/other", "--profile", "work"])).toEqual([
            "--import",
            "tsx",
            "/repo/src/vs/diode/main.ts",
            "/other",
            "--profile",
            "work",
        ]);
        expect(restartArgs(seaSnapshot(), [])).toEqual([]);
    });

    it("dev without a main script: an error, not a bare node launch", () => {
        expect(() => restartArgs(devSnapshot({ argv: ["/usr/bin/node"] }))).toThrow(/main script/);
        expect(() => restartArgs(devSnapshot({ argv: ["/usr/bin/node", ""] }))).toThrow(/main script/);
    });
});

describe("restartProcess", () => {
    it("a supervised process just exits with a special code; the supervisor starts the new window", () => {
        const { hooks, spawns, written } = createHooks([]);

        const code = runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1" } }), hooks);

        expect(code).toBe(RELOAD_EXIT_CODE);
        expect(spawns).toEqual([]);
        // The arguments didn't change: the supervisor has nothing to leave, even when there is a file for them.
        runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: "/tmp/sup.json" } }), hooks);
        expect(written).toEqual([]);
    });

    it("a supervised process with other arguments leaves them to the supervisor in a file", () => {
        const { hooks, written } = createHooks([]);
        const env = { [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: "/tmp/sup.json" };

        const code = runRestart(devSnapshot({ env }), hooks, ["/other", "--profile", "work"]);

        expect(code).toBe(RELOAD_EXIT_CODE);
        expect(written).toEqual([{ filePath: "/tmp/sup.json", userArgs: ["/other", "--profile", "work"] }]);
    });

    it("a supervised process without a file in the environment (old supervisor): nowhere to put arguments, plain reload", () => {
        const { hooks, written } = createHooks([]);

        runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1" } }), hooks, ["/other"]);
        runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: "" } }), hooks, ["/other"]);

        expect(written).toEqual([]);
    });

    it("the first reload turns the process into a supervisor: it holds the terminal and waits for the child", () => {
        const { hooks, spawns } = createHooks([0]);

        const code = runRestart(devSnapshot(), hooks);

        expect(code).toBe(0);
        expect(spawns).toHaveLength(1);
        expect(spawns[0].command).toBe("/usr/bin/node");
        expect(spawns[0].args).toEqual(restartArgs(devSnapshot()));
        // stdio is inherited, otherwise the new window would draw into a pipe instead of the terminal;
        // the env flag tells the child it already has a supervisor.
        expect(spawns[0].options).toEqual({
            stdio: "inherit",
            env: { HOME: "/home/user", [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: "/tmp/relaunch.json" },
        });
    });

    it("the first reload with other arguments starts the child with them right away", () => {
        const { hooks, spawns, reads } = createHooks([0]);

        runRestart(devSnapshot(), hooks, ["/other", "--profile", "work"]);

        expect(spawns[0].args).toEqual(restartArgs(devSnapshot(), ["/other", "--profile", "work"]));
        // The child exited without a reload: the arguments file isn't read.
        expect(reads).toEqual([]);
    });

    it("a child that asks for reload is started again, however many times it asks", () => {
        const { hooks, spawns } = createHooks([RELOAD_EXIT_CODE, RELOAD_EXIT_CODE, 3]);

        const code = runRestart(devSnapshot(), hooks);

        expect(spawns).toHaveLength(3);
        expect(code).toBe(3);
    });

    it("arguments the child leaves in the file go to the next window and stay for later ones", () => {
        const { hooks, spawns, reads } = createHooks(
            [RELOAD_EXIT_CODE, RELOAD_EXIT_CODE, RELOAD_EXIT_CODE, 0],
            [null, ["/other", "--profile", "work"], null],
        );

        runRestart(devSnapshot(), hooks);

        expect(reads).toEqual(["/tmp/relaunch.json", "/tmp/relaunch.json", "/tmp/relaunch.json"]);
        const original = restartArgs(devSnapshot());
        const changed = restartArgs(devSnapshot(), ["/other", "--profile", "work"]);
        expect(spawns.map((s) => s.args)).toEqual([original, original, changed, changed]);
    });

    it("a child killed by a signal (no exit code) closes the supervisor with a failure", () => {
        const { hooks } = createHooks([null]);

        expect(runRestart(devSnapshot(), hooks)).toBe(1);
    });

    it("the original environment is not mutated; the supervisor flag is visible only to the child", () => {
        const env: NodeJS.ProcessEnv = { HOME: "/home/user" };
        const { hooks } = createHooks([0]);

        runRestart(devSnapshot({ env }), hooks);

        expect(env[SUPERVISED_ENV]).toBeUndefined();
    });
});

describe("production hooks and process snapshot", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("the snapshot takes the real process fields", () => {
        const snapshot = currentProcessSnapshot();

        expect(snapshot.execPath).toBe(process.execPath);
        expect(snapshot.argv).toBe(process.argv);
        expect(snapshot.execArgv).toBe(process.execArgv);
        expect(snapshot.env).toBe(process.env);
        // Tests don't run from a SEA binary, otherwise the snapshot would lie about the command line.
        expect(snapshot.isSea).toBe(false);
    });

    it("spawnSync really runs the process and returns its exit code", () => {
        const result = realRestartHooks.spawnSync(process.execPath, ["-e", "process.exit(7)"], {
            stdio: "inherit",
            env: process.env,
        });

        expect(result.status).toBe(7);
    });

    it("args file: written as a JSON array, read once and removed", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-relaunch-test-"));
        try {
            const file = path.join(dir, "relaunch.json");
            expect(realRestartHooks.readRelaunchFile(file)).toBeNull();
            realRestartHooks.writeRelaunchFile(file, ["/work", "--profile", "work"]);
            expect(realRestartHooks.readRelaunchFile(file)).toEqual(["/work", "--profile", "work"]);
            expect(fs.existsSync(file)).toBe(false);
            fs.writeFileSync(file, "{not json");
            expect(realRestartHooks.readRelaunchFile(file)).toBeNull();
            expect(fs.existsSync(file)).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("the args file path is in tmpdir, with the pid in its name", () => {
        const file = realRestartHooks.relaunchFilePath();
        expect(path.dirname(file)).toBe(os.tmpdir());
        expect(path.basename(file)).toBe(`diode-relaunch-${String(process.pid)}.json`);
    });

    it("parseRelaunchArgs: string arrays only", () => {
        expect(parseRelaunchArgs('["a","b"]')).toEqual(["a", "b"]);
        expect(parseRelaunchArgs("[]")).toEqual([]);
        expect(parseRelaunchArgs('{"a":1}')).toBeNull();
        expect(parseRelaunchArgs("[1]")).toBeNull();
        expect(parseRelaunchArgs("nope")).toBeNull();
    });

    it("exit goes to process.exit with the same code", () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

        realRestartHooks.exit(RELOAD_EXIT_CODE);

        expect(exitSpy).toHaveBeenCalledWith(RELOAD_EXIT_CODE);
    });
});
