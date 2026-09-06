import { afterEach, describe, expect, it, vi } from "vitest";

import type { IProcessSnapshot, IRestartHooks, ISpawnResult } from "./restartProcess.ts";
import {
    currentProcessSnapshot,
    realRestartHooks,
    restartArgs,
    restartProcess,
    RELOAD_EXIT_CODE,
    SUPERVISED_ENV,
} from "./restartProcess.ts";

/** Снимок dev-запуска (`node --import tsx main.ts <файлы>`). */
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

/** Хуки, записывающие вызовы; `statuses` — коды выхода детей по порядку. */
function createHooks(statuses: readonly (number | null)[]): {
    hooks: IRestartHooks;
    spawns: IRecordedSpawn[];
} {
    const spawns: IRecordedSpawn[] = [];
    let call = 0;
    const hooks: IRestartHooks = {
        spawnSync: (command, args, options): ISpawnResult => {
            spawns.push({ command, args, options });
            const status = statuses[call++];
            return { status: status ?? null };
        },
        exit: (code) => {
            throw new ExitCalled(code);
        },
    };
    return { hooks, spawns };
}

/** Прогоняет перезапуск и возвращает код, с которым он вышел. */
function runRestart(snapshot: IProcessSnapshot, hooks: IRestartHooks): number {
    try {
        restartProcess(snapshot, hooks);
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

    it("dev без главного скрипта — ошибка, а не запуск голого node", () => {
        expect(() => restartArgs(devSnapshot({ argv: ["/usr/bin/node"] }))).toThrow(/main script/);
        expect(() => restartArgs(devSnapshot({ argv: ["/usr/bin/node", ""] }))).toThrow(/main script/);
    });
});

describe("restartProcess", () => {
    it("supervised-процесс просто выходит специальным кодом — новое окно поднимет супервизор", () => {
        const { hooks, spawns } = createHooks([]);

        const code = runRestart(devSnapshot({ env: { [SUPERVISED_ENV]: "1" } }), hooks);

        expect(code).toBe(RELOAD_EXIT_CODE);
        expect(spawns).toEqual([]);
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
            env: { HOME: "/home/user", [SUPERVISED_ENV]: "1" },
        });
    });

    it("ребёнок, попросивший reload, поднимается снова — сколько бы раз ни просил", () => {
        const { hooks, spawns } = createHooks([RELOAD_EXIT_CODE, RELOAD_EXIT_CODE, 3]);

        const code = runRestart(devSnapshot(), hooks);

        expect(spawns).toHaveLength(3);
        expect(code).toBe(3);
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

    it("exit уходит в process.exit с тем же кодом", () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

        realRestartHooks.exit(RELOAD_EXIT_CODE);

        expect(exitSpy).toHaveBeenCalledWith(RELOAD_EXIT_CODE);
    });
});
