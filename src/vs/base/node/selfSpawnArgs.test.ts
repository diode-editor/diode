import { describe, expect, it } from "vitest";

import type { IProcessSnapshot } from "./restartProcess.ts";
import { selfSpawnArgs } from "./selfSpawnArgs.ts";

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
