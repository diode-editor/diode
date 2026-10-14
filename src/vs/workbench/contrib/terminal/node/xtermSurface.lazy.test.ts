import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { setLazyModuleLoader } from "../../../../base/common/lazyModule.ts";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";
import { ExtensionPtySession } from "./extensionPtySession.ts";
import type { XtermNamespace } from "./xtermSurface.ts";

// @xterm/headless — ленивый кусок бандла: эмулятор появляется, когда кусок
// загрузился. Здесь загрузчик придерживаем вручную и проверяем гонки «человек
// или процесс успели раньше куска»: вывод не теряется и идёт по порядку, ввод
// и ресайз доходят до процесса, ничего не падает.

function row(session: ExtensionPtySession | EmbeddedTerminalSession, y: number, width: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < width; x++) {
        if (session.readCell(x, y, out)) text += out.char;
    }
    return text.trimEnd();
}

/** Загрузчик кусков, который отдаёт модуль только по `release()` (или отказывает по `fail()`). */
function holdLoader() {
    const requested: string[] = [];
    let release!: () => void;
    let fail!: (error: Error) => void;
    const gate = new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
    });
    setLazyModuleLoader(async <T>(id: string, importer: () => Promise<T>): Promise<T> => {
        requested.push(id);
        await gate;
        return importer();
    });
    return { requested, release, fail };
}

function makePty(cols = 30, rows = 4) {
    const onInput = vi.fn<(data: string) => void>();
    const onResize = vi.fn<(cols: number, rows: number) => void>();
    const session = new ExtensionPtySession({ cols, rows, name: "pty", onInput, onResize });
    return { session, onInput, onResize };
}

describe("XtermSurface — эмулятор из ленивого куска", () => {
    afterEach(() => {
        setLazyModuleLoader(undefined);
        setUnexpectedErrorHandler((e) => {
            console.error(e);
        });
    });

    it("кусок спрашивают при создании сессии, а не раньше; каждая из нескольких сессий получает свой вывод", async () => {
        const loader = holdLoader();
        expect(loader.requested).toStrictEqual([]);
        const first = makePty().session;
        const second = makePty().session;
        expect(loader.requested).toStrictEqual(["@xterm/headless", "@xterm/headless"]);
        first.feed("one");
        second.feed("two");
        loader.release();
        await Promise.all([first.xtermReady, second.xtermReady]);
        await vi.waitFor(() => {
            expect(row(first, 0, 30)).toBe("one");
            expect(row(second, 0, 30)).toBe("two");
        });
        first.dispose();
        second.dispose();
    });

    it("до куска: сетка пустая, курсора и mouse-режима нет, мышь и прокрутка — no-op; вывод копится и уходит по порядку", async () => {
        const loader = holdLoader();
        const { session, onInput } = makePty();
        const updates = vi.fn();
        session.onUpdate(updates);
        session.feed("\u001b[?1003h\u001b[?1006h");
        session.feed("first\r\n");
        session.feed("second");
        session.scrollLines(-3);
        session.sendMouse({ col: 1, row: 0, button: "left", action: "down", ctrl: false, alt: false, shift: false });
        await new Promise((resolve) => setTimeout(resolve, 10));
        // Ячейки нет — и `out` не тронут.
        const out: TerminalCell = { char: "?", fg: 1, bg: 2, style: 3, width: 1 };
        expect(session.readCell(0, 0, out)).toBe(false);
        expect(out).toStrictEqual({ char: "?", fg: 1, bg: 2, style: 3, width: 1 });
        expect(session.getCursor()).toBeNull();
        expect(session.mouseEventsActive).toBe(false);
        expect(session.scrollOffset).toBe(0);
        expect(onInput).not.toHaveBeenCalled();
        expect(updates).not.toHaveBeenCalled();

        loader.release();
        await session.xtermReady;
        await vi.waitFor(() => {
            expect(row(session, 0, 30)).toBe("first");
            expect(row(session, 1, 30)).toBe("second");
        });
        expect(session.getCursor()).toStrictEqual({ x: 6, y: 1 });
        // Режим мыши из накопленного вывода дошёл до эмулятора.
        expect(session.mouseEventsActive).toBe(true);
        expect(updates).toHaveBeenCalled();
        session.dispose();
    });

    it("до куска: ввод и ресайз уходят процессу сразу; эмулятор рождается уже нового размера", async () => {
        const loader = holdLoader();
        const { session, onInput, onResize } = makePty(10, 4);
        session.write("ls\r");
        session.resize(40, 6);
        expect(onInput).toHaveBeenCalledWith("ls\r");
        expect(onResize).toHaveBeenCalledWith(40, 6);
        session.feed("x".repeat(35));
        loader.release();
        await session.xtermReady;
        // Ширина 40, а не исходные 10: строка не перенеслась.
        await vi.waitFor(() => {
            expect(row(session, 0, 40)).toBe("x".repeat(35));
        });
        session.dispose();
    });

    it("dispose до куска: эмулятор не создаётся, накопленный вывод не всплывает", async () => {
        const loader = holdLoader();
        const { session } = makePty();
        session.feed("late");
        session.dispose();
        loader.release();
        await session.xtermReady;
        expect(row(session, 0, 30)).toBe("");
        expect(session.getCursor()).toBeNull();
    });

    it("кусок не загрузился: ошибка — в onUnexpectedError, сессия выходит с кодом 1, вывод сброшен", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        const loader = holdLoader();
        const { session } = makePty();
        const exits = vi.fn();
        session.onExit(exits);
        session.feed("lost");
        const broken = new Error("кусок битый");
        loader.fail(broken);
        await session.xtermReady;
        expect(errors).toStrictEqual([broken]);
        expect(exits.mock.calls).toStrictEqual([[1]]);
        expect(row(session, 0, 30)).toBe("");
        session.dispose();
    });

    it("отказ куска после dispose: ошибка в лог, но onExit уже закрытой сессии не стреляет", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        const loader = holdLoader();
        const { session } = makePty();
        const exits = vi.fn();
        session.onExit(exits);
        session.dispose();
        loader.fail(new Error("кусок битый"));
        await session.xtermReady;
        expect(errors).toHaveLength(1);
        expect(exits).not.toHaveBeenCalled();
    });

    it("эмулятор строится из того, что отдал загрузчик (`default` пространства имён), с размером и скролбэком сессии", async () => {
        const real = await import("@xterm/headless");
        const constructed: unknown[] = [];
        class SpyTerminal extends real.default.Terminal {
            public constructor(options: ConstructorParameters<typeof real.default.Terminal>[0]) {
                super(options);
                constructed.push(options);
            }
        }
        const namespace: XtermNamespace = { default: { ...real.default, Terminal: SpyTerminal } };
        setLazyModuleLoader(<T>() => Promise.resolve(namespace as T));
        const session = new EmbeddedTerminalSession({
            cols: 33,
            rows: 5,
            scrollback: 7,
            shell: "/bin/bash",
            args: ["-c", "exit 0"],
        });
        await session.xtermReady;
        expect(constructed).toStrictEqual([{ cols: 33, rows: 5, allowProposedApi: true, scrollback: 7 }]);
        session.dispose();
    }, 20000);

    it("шелл, который успел вывести и выйти до куска: вывод на экране, код выхода — как был", async () => {
        const loader = holdLoader();
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 4,
            shell: "/bin/bash",
            args: ["-c", "echo early-bird; exit 3"],
        });
        const code = await new Promise<number>((resolve) => {
            session.onExit(resolve);
        });
        expect(code).toBe(3);
        expect(row(session, 0, 40)).toBe("");
        loader.release();
        await session.xtermReady;
        await vi.waitFor(() => {
            expect(row(session, 0, 40)).toBe("early-bird");
        });
        session.dispose();
    }, 20000);

    it("кусок не загрузился у шелла: PTY убит (процесс не висит без экрана)", async () => {
        setUnexpectedErrorHandler(() => {});
        const loader = holdLoader();
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 4,
            shell: "/bin/bash",
            args: ["-c", "sleep 30"],
        });
        const pid = session.pid;
        loader.fail(new Error("кусок битый"));
        await session.xtermReady;
        await vi.waitFor(() => {
            expect(isAlive(pid)).toBe(false);
        });
        session.dispose();
    }, 20000);
});

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
