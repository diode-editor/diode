import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { type SpawnOpener, spawnOpenerProcess, SystemExternalOpener } from "./systemExternalOpener.ts";

/** Фейковый ChildProcess: тест сам решает, чем кончился запуск открывателя. */
class FakeChild extends EventEmitter {
    public unrefCalls = 0;
    public unref(): this {
        this.unrefCalls++;
        return this;
    }
}

function makeOpener(options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}): {
    opener: SystemExternalOpener;
    calls: { command: string; args: readonly string[] }[];
    child: FakeChild;
} {
    const child = new FakeChild();
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawnOpener: SpawnOpener = (command, args) => {
        calls.push({ command, args });
        return child as unknown as ChildProcess;
    };
    const opener = new SystemExternalOpener({
        platform: options.platform ?? "linux",
        env: options.env ?? { DISPLAY: ":0" },
        spawnOpener,
    });
    return { opener, calls, child };
}

describe("SystemExternalOpener — можно ли открывать", () => {
    it("ssh-сессия: браузер открылся бы на сервере, а не у человека", async () => {
        const { opener, calls } = makeOpener({ env: { SSH_CONNECTION: "1.2.3.4 22 5.6.7.8 22", DISPLAY: ":0" } });
        expect(opener.canOpen()).toBe(false);
        await expect(opener.openExternal("https://example.com")).resolves.toBe(false);
        expect(calls).toEqual([]);
    });

    it("Linux без DISPLAY/WAYLAND_DISPLAY: графической сессии нет", async () => {
        const { opener } = makeOpener({ env: {} });
        expect(opener.canOpen()).toBe(false);
        await expect(opener.openExternal("https://example.com")).resolves.toBe(false);
    });

    it("Wayland без DISPLAY — можно", () => {
        expect(makeOpener({ env: { WAYLAND_DISPLAY: "wayland-0" } }).opener.canOpen()).toBe(true);
    });

    it("mac и Windows графической сессией не гейтятся", () => {
        expect(makeOpener({ platform: "darwin", env: {} }).opener.canOpen()).toBe(true);
        expect(makeOpener({ platform: "win32", env: {} }).opener.canOpen()).toBe(true);
    });
});

describe("SystemExternalOpener — адрес", () => {
    it.each(["/etc/passwd", "--help", "example.com", ""])("адрес без схемы не открываем: %s", async (target) => {
        const { opener, calls } = makeOpener();
        await expect(opener.openExternal(target)).resolves.toBe(false);
        expect(calls).toEqual([]);
    });

    // Схема обязана стоять В НАЧАЛЕ: без анкера «--flag https://зло» прошло бы
    // проверку и уехало открывателю первым аргументом, то есть флагом.
    it.each(["--flag https://example.com", " https://example.com", "-x mailto:a@b"])(
        "схема в середине адреса не считается схемой: %s",
        async (target) => {
            const { opener, calls } = makeOpener();
            await expect(opener.openExternal(target)).resolves.toBe(false);
            expect(calls).toEqual([]);
        },
    );
});

describe("SystemExternalOpener — запуск", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        return () => {
            vi.useRealTimers();
        };
    });

    it("команда платформы: xdg-open / open / cmd start", async () => {
        for (const [platform, expected] of [
            ["linux", ["xdg-open", ["https://example.com"]]],
            ["darwin", ["open", ["https://example.com"]]],
            ["win32", ["cmd", ["/c", "start", "", "https://example.com"]]],
        ] as const) {
            const { opener, calls, child } = makeOpener({ platform, env: { DISPLAY: ":0" } });
            const opened = opener.openExternal("https://example.com");
            child.emit("exit", 0);
            await expect(opened).resolves.toBe(true);
            expect(calls).toEqual([{ command: expected[0], args: expected[1] }]);
        }
    });

    it("открыватель вышел с ненулевым кодом — ссылка не ушла", async () => {
        const { opener, child } = makeOpener();
        const opened = opener.openExternal("https://example.com");
        child.emit("exit", 3);
        await expect(opened).resolves.toBe(false);
    });

    it("`error` (нет xdg-open) слушаем: иначе EventEmitter убил бы редактор", async () => {
        const { opener, child } = makeOpener();
        const opened = opener.openExternal("https://example.com");
        child.emit("error", new Error("ENOENT"));
        await expect(opened).resolves.toBe(false);
    });

    it("открыватель не вышел за таймаут — считаем адрес отданным системе", async () => {
        const { opener } = makeOpener();
        const opened = opener.openExternal("https://example.com");
        await vi.advanceTimersByTimeAsync(3000);
        await expect(opened).resolves.toBe(true);
    });

    it("исход фиксируется один раз: exit после error ничего не меняет", async () => {
        const { opener, child } = makeOpener();
        const opened = opener.openExternal("https://example.com");
        child.emit("error", new Error("ENOENT"));
        child.emit("exit", 0);
        await vi.advanceTimersByTimeAsync(5000);
        await expect(opened).resolves.toBe(false);
    });

    it("процесс открывателя отпущен: он не держит наш event loop", async () => {
        const { opener, child } = makeOpener();
        const opened = opener.openExternal("https://example.com");
        child.emit("exit", 0);
        await opened;
        expect(child.unrefCalls).toBe(1);
    });

    it("синхронный отказ spawn (битый PATH) — false, а не исключение наружу", async () => {
        const opener = new SystemExternalOpener({
            platform: "linux",
            env: { DISPLAY: ":0" },
            spawnOpener: () => {
                throw new Error("EACCES");
            },
        });
        await expect(opener.openExternal("https://example.com")).resolves.toBe(false);
    });

    it("дефолтный spawnOpener не подменён — конструктор берёт production-запуск", () => {
        const opener = new SystemExternalOpener({ platform: "linux", env: {} });
        expect(opener.canOpen()).toBe(false);
    });
});

describe("spawnOpenerProcess", () => {
    /** Код выхода реально запущенного процесса; `null` — спавн не состоялся. */
    function exitCodeOf(command: string, args: readonly string[]): Promise<number | null> {
        const child = spawnOpenerProcess(command, args);
        expect(child.stdout).toBeNull();
        return new Promise((resolve) => {
            child.once("error", () => {
                resolve(null);
            });
            child.once("exit", (code) => {
                resolve(code);
            });
        });
    }

    // Свой же исполняемый файл: портируемо и безобидно — настоящий `xdg-open`
    // открыл бы что-нибудь у того, кто гоняет тесты.
    it("запускает процесс с закрытым stdio", async () => {
        await expect(exitCodeOf(process.execPath, ["-e", ""])).resolves.toBe(0);
    });

    it("аргументы доезжают до процесса — без них адрес не открылся бы", async () => {
        await expect(exitCodeOf(process.execPath, ["-e", "process.exit(7)"])).resolves.toBe(7);
    });
});
