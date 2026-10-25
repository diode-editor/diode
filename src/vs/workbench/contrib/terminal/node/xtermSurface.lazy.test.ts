import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { setLazyModuleLoader } from "../../../../base/common/lazyModule.ts";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";
import { ExtensionPtySession } from "./extensionPtySession.ts";
import type { XtermNamespace } from "./xtermSurface.ts";

// The chunk loader is held back manually: races where the user or the process gets ahead of the chunk.

function row(session: ExtensionPtySession | EmbeddedTerminalSession, y: number, width: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < width; x++) {
        if (session.readCell(x, y, out)) text += out.char;
    }
    return text.trimEnd();
}

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

describe("XtermSurface — emulator from a lazy chunk", () => {
    afterEach(() => {
        setLazyModuleLoader(undefined);
        setUnexpectedErrorHandler((e) => {
            console.error(e);
        });
    });

    it("the chunk is requested on session creation, not earlier; each of several sessions gets its own output", async () => {
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

    it("before the chunk: empty grid, no cursor or mouse mode, mouse and scrolling are no-ops; output is buffered and flushed in order", async () => {
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
        // No cell — and `out` is untouched.
        const out: TerminalCell = { char: "?", fg: 1, bg: 2, style: 3, width: 1 };
        expect(session.readCell(0, 0, out)).toBe(false);
        expect(out).toStrictEqual({ char: "?", fg: 1, bg: 2, style: 3, width: 1 });
        expect(session.getCursor()).toBeNull();
        expect(session.mouseEventsActive).toBe(false);
        expect(session.scrollOffset).toBe(0);
        expect(session.buffer).toBeUndefined();
        expect(onInput).not.toHaveBeenCalled();
        expect(updates).not.toHaveBeenCalled();

        loader.release();
        await session.xtermReady;
        await vi.waitFor(() => {
            expect(row(session, 0, 30)).toBe("first");
            expect(row(session, 1, 30)).toBe("second");
        });
        expect(session.getCursor()).toStrictEqual({ x: 6, y: 1 });
        expect(session.buffer?.getLine(1)?.translateToString(true)).toBe("second");
        // The mouse mode from queued output reached the emulator.
        expect(session.mouseEventsActive).toBe(true);
        expect(updates).toHaveBeenCalled();
        session.dispose();
    });

    it("before the chunk: input and resize go to the process right away; the emulator is born with the new size", async () => {
        const loader = holdLoader();
        const { session, onInput, onResize } = makePty(10, 4);
        session.write("ls\r");
        session.resize(40, 6);
        expect(onInput).toHaveBeenCalledWith("ls\r");
        expect(onResize).toHaveBeenCalledWith(40, 6);
        session.feed("x".repeat(35));
        loader.release();
        await session.xtermReady;
        // Width 40, not the initial 10: the line didn't wrap.
        await vi.waitFor(() => {
            expect(row(session, 0, 40)).toBe("x".repeat(35));
        });
        session.dispose();
    });

    it("dispose before the chunk: no emulator is created, buffered output doesn't surface", async () => {
        const loader = holdLoader();
        const { session } = makePty();
        session.feed("late");
        session.dispose();
        loader.release();
        await session.xtermReady;
        expect(row(session, 0, 30)).toBe("");
        expect(session.getCursor()).toBeNull();
    });

    it("the chunk failed to load: the error goes to onUnexpectedError, the session exits with code 1, output dropped", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        const loader = holdLoader();
        const { session } = makePty();
        const exits = vi.fn();
        session.onExit(exits);
        session.feed("lost");
        const broken = new Error("broken chunk");
        loader.fail(broken);
        await session.xtermReady;
        expect(errors).toStrictEqual([broken]);
        expect(exits.mock.calls).toStrictEqual([[1]]);
        expect(row(session, 0, 30)).toBe("");
        session.dispose();
    });

    it("chunk refusal after dispose: the error is logged, but onExit of the closed session doesn't fire", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((e) => errors.push(e));
        const loader = holdLoader();
        const { session } = makePty();
        const exits = vi.fn();
        session.onExit(exits);
        session.dispose();
        loader.fail(new Error("broken chunk"));
        await session.xtermReady;
        expect(errors).toHaveLength(1);
        expect(exits).not.toHaveBeenCalled();
    });

    it("the emulator is built from what the loader returned (the namespace `default`), with the session size and scrollback", async () => {
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

    it("ESM namespace shape (only a named `Terminal`, no `default` — how tsx serves the module from sources) — the emulator is built too", async () => {
        const real = await import("@xterm/headless");
        const constructed: unknown[] = [];
        class SpyTerminal extends real.default.Terminal {
            public constructor(options: ConstructorParameters<typeof real.default.Terminal>[0]) {
                super(options);
                constructed.push(options);
            }
        }
        const namespace: XtermNamespace = { ...real.default, Terminal: SpyTerminal };
        setLazyModuleLoader(<T>() => Promise.resolve(namespace as T));
        const session = new EmbeddedTerminalSession({
            cols: 21,
            rows: 3,
            shell: "/bin/bash",
            args: ["-c", "exit 0"],
        });
        await session.xtermReady;
        expect(constructed).toStrictEqual([{ cols: 21, rows: 3, allowProposedApi: true, scrollback: 1000 }]);
        session.dispose();
    }, 20000);

    it("a shell that printed and exited before the chunk: the exit waits for the emulator, output first", async () => {
        const loader = holdLoader();
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 4,
            shell: "/bin/bash",
            args: ["-c", "echo early-bird; exit 3"],
        });
        const lines: string[] = [];
        session.onLineData((line) => lines.push(line));
        const exited = new Promise<number>((resolve) => {
            session.onExit(resolve);
        });
        await vi.waitFor(() => {
            expect(session.isExited).toBe(true);
        });
        loader.release();
        expect(await exited).toBe(3);
        // By the exit event the output is on screen and its lines are reported.
        expect(row(session, 0, 40)).toBe("early-bird");
        expect(lines).toStrictEqual(["early-bird"]);
        session.dispose();
    }, 20000);

    it("the chunk failed to load after the shell exited: the exit keeps the shell's code", async () => {
        setUnexpectedErrorHandler(() => {});
        const loader = holdLoader();
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 4,
            shell: "/bin/bash",
            args: ["-c", "exit 4"],
        });
        const exits = vi.fn();
        session.onExit(exits);
        await vi.waitFor(() => {
            expect(session.isExited).toBe(true);
        });
        expect(exits).not.toHaveBeenCalled();
        loader.fail(new Error("broken chunk"));
        await session.xtermReady;
        expect(exits.mock.calls).toStrictEqual([[4]]);
        session.dispose();
    }, 20000);

    it("the chunk failed to load for a shell: the PTY is killed (the process doesn't hang without a screen)", async () => {
        setUnexpectedErrorHandler(() => {});
        const loader = holdLoader();
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 4,
            shell: "/bin/bash",
            args: ["-c", "sleep 30"],
        });
        const pid = session.pid;
        loader.fail(new Error("broken chunk"));
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
