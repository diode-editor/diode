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

/** Снимок SEA-бинаря: `argv[1]` — сам бинарь, а не скрипт. */
function seaSnapshot(overrides: Partial<IProcessSnapshot> = {}): IProcessSnapshot {
    return devSnapshot({
        execPath: "/opt/diode",
        execArgv: [],
        argv: ["/opt/diode", "/opt/diode", "/work", "--headless=80x24"],
        isSea: true,
        ...overrides,
    });
}

/** Ошибка-заглушка вместо `process.exit`: хук обязан не возвращать управление. */
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
 * Хуки, записывающие вызовы; `statuses` — коды выхода детей по порядку,
 * `relaunches` — что «окно» оставило в файле аргументов перед каждым выходом
 * (`null` — ничего), по порядку перезапусков.
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
    throw new Error("restartProcess вернул управление — оно не должно возвращаться");
}

describe("restartArgs", () => {
    it("dev: node-флаги и главный скрипт впереди пользовательских аргументов", () => {
        expect(restartArgs(devSnapshot())).toEqual([
            "--import",
            "tsx",
            "/repo/src/vs/diode/main.ts",
            "/work",
            "--headless=80x24",
        ]);
    });

    it("SEA: только пользовательские аргументы — программа и есть execPath", () => {
        expect(restartArgs(seaSnapshot())).toEqual(["/work", "--headless=80x24"]);
    });

    it("явные пользовательские аргументы замещают argv[2..] целиком", () => {
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

    it("dev без главного скрипта — ошибка, а не запуск голого node", () => {
        expect(() => restartArgs(devSnapshot({ argv: ["/usr/bin/node"] }))).toThrow(/main script/);
        expect(() => restartArgs(devSnapshot({ argv: ["/usr/bin/node", ""] }))).toThrow(/main script/);
    });
});

describe("restartProcess", () => {
    it("supervised-процесс просто выходит специальным кодом — новое окно поднимет супервизор", () => {
        const { hooks, spawns, written } = createHooks([]);

        const code = runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1" } }), hooks);

        expect(code).toBe(RELOAD_EXIT_CODE);
        expect(spawns).toEqual([]);
        // Аргументы не менялись — супервизору нечего оставлять, даже когда файл для них есть.
        runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: "/tmp/sup.json" } }), hooks);
        expect(written).toEqual([]);
    });

    it("supervised-процесс с другими аргументами оставляет их супервизору в файле", () => {
        const { hooks, written } = createHooks([]);
        const env = { [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: "/tmp/sup.json" };

        const code = runRestart(devSnapshot({ env }), hooks, ["/other", "--profile", "work"]);

        expect(code).toBe(RELOAD_EXIT_CODE);
        expect(written).toEqual([{ filePath: "/tmp/sup.json", userArgs: ["/other", "--profile", "work"] }]);
    });

    it("supervised-процесс без файла в окружении (старый супервизор) — аргументы некуда положить, просто reload", () => {
        const { hooks, written } = createHooks([]);

        runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1" } }), hooks, ["/other"]);
        runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: "" } }), hooks, ["/other"]);

        expect(written).toEqual([]);
    });

    it("первый reload делает процесс супервизором: держит терминал и ждёт ребёнка", () => {
        const { hooks, spawns } = createHooks([0]);

        const code = runRestart(devSnapshot(), hooks);

        expect(code).toBe(0);
        expect(spawns).toHaveLength(1);
        expect(spawns[0].command).toBe("/usr/bin/node");
        expect(spawns[0].args).toEqual(restartArgs(devSnapshot()));
        // stdio наследуется — иначе новое окно рисовало бы в трубу, а не в терминал;
        // env-флаг говорит ребёнку, что супервизор над ним уже есть.
        expect(spawns[0].options).toEqual({
            stdio: "inherit",
            env: { HOME: "/home/user", [SUPERVISED_ENV]: "1", [RELAUNCH_FILE_ENV]: "/tmp/relaunch.json" },
        });
    });

    it("первый reload с другими аргументами поднимает ребёнка сразу с ними", () => {
        const { hooks, spawns, reads } = createHooks([0]);

        runRestart(devSnapshot(), hooks, ["/other", "--profile", "work"]);

        expect(spawns[0].args).toEqual(restartArgs(devSnapshot(), ["/other", "--profile", "work"]));
        // Ребёнок вышел не reload'ом — файл аргументов не читается.
        expect(reads).toEqual([]);
    });

    it("ребёнок, попросивший reload, поднимается снова — сколько бы раз ни просил", () => {
        const { hooks, spawns } = createHooks([RELOAD_EXIT_CODE, RELOAD_EXIT_CODE, 3]);

        const code = runRestart(devSnapshot(), hooks);

        expect(spawns).toHaveLength(3);
        expect(code).toBe(3);
    });

    it("аргументы, оставленные ребёнком в файле, идут следующему окну и остаются дальше", () => {
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

    it("ребёнок, убитый сигналом (кода нет), закрывает супервизор отказом", () => {
        const { hooks } = createHooks([null]);

        expect(runRestart(devSnapshot(), hooks)).toBe(1);
    });

    it("исходное окружение не мутируется — флаг супервизора виден только ребёнку", () => {
        const env: NodeJS.ProcessEnv = { HOME: "/home/user" };
        const { hooks } = createHooks([0]);

        runRestart(devSnapshot({ env }), hooks);

        expect(env[SUPERVISED_ENV]).toBeUndefined();
    });
});

describe("боевые хуки и снимок процесса", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("снимок берёт настоящие поля процесса", () => {
        const snapshot = currentProcessSnapshot();

        expect(snapshot.execPath).toBe(process.execPath);
        expect(snapshot.argv).toBe(process.argv);
        expect(snapshot.execArgv).toBe(process.execArgv);
        expect(snapshot.env).toBe(process.env);
        // Тесты идут не из SEA-бинаря — иначе снимок соврал бы про командную строку.
        expect(snapshot.isSea).toBe(false);
    });

    it("spawnSync действительно запускает процесс и отдаёт его код выхода", () => {
        const result = realRestartHooks.spawnSync(process.execPath, ["-e", "process.exit(7)"], {
            stdio: "inherit",
            env: process.env,
        });

        expect(result.status).toBe(7);
    });

    it("файл аргументов: пишется JSON-массивом, читается один раз и снимается", () => {
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

    it("путь файла аргументов — в tmpdir, с pid в имени", () => {
        const file = realRestartHooks.relaunchFilePath();
        expect(path.dirname(file)).toBe(os.tmpdir());
        expect(path.basename(file)).toBe(`diode-relaunch-${String(process.pid)}.json`);
    });

    it("parseRelaunchArgs: только массив строк", () => {
        expect(parseRelaunchArgs('["a","b"]')).toEqual(["a", "b"]);
        expect(parseRelaunchArgs("[]")).toEqual([]);
        expect(parseRelaunchArgs('{"a":1}')).toBeNull();
        expect(parseRelaunchArgs("[1]")).toBeNull();
        expect(parseRelaunchArgs("nope")).toBeNull();
    });

    it("exit уходит в process.exit с тем же кодом", () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

        realRestartHooks.exit(RELOAD_EXIT_CODE);

        expect(exitSpy).toHaveBeenCalledWith(RELOAD_EXIT_CODE);
    });
});
