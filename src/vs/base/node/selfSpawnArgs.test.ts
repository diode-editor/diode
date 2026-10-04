import { describe, expect, it } from "vitest";

import type { IProcessSnapshot } from "./restartProcess.ts";
import { selfSpawnArgs, spawnSelfAsRole } from "./selfSpawnArgs.ts";

function snapshot(overrides: Partial<IProcessSnapshot> = {}): IProcessSnapshot {
    return {
        execPath: "/usr/bin/node",
        execArgv: ["--import", "tsx"],
        argv: ["/usr/bin/node", "/repo/src/vs/diode/main.ts", "file.ts"],
        isSea: false,
        env: {},
        ...overrides,
    };
}

describe("selfSpawnArgs", () => {
    it("dev: node + execArgv + главный скрипт (loader'ы обязаны доехать до ребёнка)", () => {
        expect(selfSpawnArgs(snapshot())).toEqual({
            command: "/usr/bin/node",
            args: ["--import", "tsx", "/repo/src/vs/diode/main.ts"],
        });
    });

    it("dev: пользовательские аргументы ребёнку не передаются — у него своя роль", () => {
        expect(selfSpawnArgs(snapshot()).args).not.toContain("file.ts");
    });

    it("SEA: сам бинарь без аргументов — главного скрипта у него нет", () => {
        expect(
            selfSpawnArgs(snapshot({ execPath: "/opt/diode", isSea: true, argv: ["/opt/diode", "file.ts"] })),
        ).toEqual({ command: "/opt/diode", args: [] });
    });

    it("dev без главного скрипта — явная ошибка, а не молчаливый запуск не того", () => {
        expect(() => selfSpawnArgs(snapshot({ argv: ["/usr/bin/node"] }))).toThrow(/cannot determine main script/);
    });

    it("пустая строка вместо главного скрипта — та же ошибка", () => {
        expect(() => selfSpawnArgs(snapshot({ argv: ["/usr/bin/node", ""] }))).toThrow(/cannot determine main script/);
    });

    it("без аргумента снимок берётся с текущего процесса", () => {
        expect(selfSpawnArgs().command).toBe(process.execPath);
    });
});

describe("spawnSelfAsRole", () => {
    /** Ребёнок-заглушка: шлёт по IPC флаг роли, значение из env и то, открыт ли ему stdout. */
    const probe = `process.send({ role: process.env.DIODE_FILE_WATCHER, inherited: process.env.DIODE_PROBE, stdout: process.stdout.isTTY === undefined && process.stdout.writable }, () => process.exit(0));`;
    const spec = { command: process.execPath, args: ["-e", probe] };

    it("флаг роли в env поверх переданного окружения, IPC-канал, stdout по умолчанию закрыт", async () => {
        const child = spawnSelfAsRole("DIODE_FILE_WATCHER", {
            stderr: "ignore",
            spec,
            env: { DIODE_PROBE: "yes", PATH: process.env.PATH },
        });
        const message = await new Promise((resolve) => child.once("message", resolve));

        expect(message).toMatchObject({ role: "1", inherited: "yes" });
        expect(child.stdout).toBeNull();
        expect(child.stderr).toBeNull();
        await new Promise((resolve) => child.once("exit", resolve));
    });

    it("stdout и stderr — потоки, когда их просят читать; env по умолчанию — process.env", async () => {
        const child = spawnSelfAsRole("DIODE_FILE_WATCHER", { stdout: "pipe", stderr: "pipe", spec });
        const message = await new Promise((resolve) => child.once("message", resolve));

        expect(message).toMatchObject({ role: "1" });
        expect(child.stdout).not.toBeNull();
        expect(child.stderr).not.toBeNull();
        await new Promise((resolve) => child.once("exit", resolve));
    });
});
