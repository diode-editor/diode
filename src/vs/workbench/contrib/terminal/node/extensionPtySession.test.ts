import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { describe, expect, it, vi } from "vitest";

import { ExtensionPtySession } from "./extensionPtySession.ts";

// Эмулятор над pty расширения — настоящий @xterm/headless, процесса нет.

function row(session: ExtensionPtySession, y: number, width: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < width; x++) {
        if (session.readCell(x, y, out)) text += out.char;
    }
    return text.trimEnd();
}

function make() {
    const onInput = vi.fn<(data: string) => void>();
    const onResize = vi.fn<(cols: number, rows: number) => void>();
    const session = new ExtensionPtySession({ cols: 30, rows: 4, name: "Bazel Build Status", onInput, onResize });
    return { session, onInput, onResize };
}

describe("ExtensionPtySession — эмулятор без процесса", () => {
    it("feed рисует вывод расширения в сетку (ANSI-цвета — эмулятору); имя вместо шелла, pid нет", async () => {
        const { session } = make();
        expect(session.shell).toBe("Bazel Build Status");
        expect(session.pid).toBeUndefined();
        const updated = vi.fn();
        session.onUpdate(updated);
        session.feed("\u001b[32mgreen\u001b[0m\r\nplain");
        await vi.waitFor(() => {
            expect(row(session, 0, 30)).toBe("green");
            expect(row(session, 1, 30)).toBe("plain");
        });
        expect(updated).toHaveBeenCalled();
        session.dispose();
    });

    it("набор человека уходит в onInput, ресайз — в onResize; одинаковый размер — no-op", () => {
        const { session, onInput, onResize } = make();
        session.write("abc");
        session.resize(30, 4);
        session.resize(50, 10);
        expect(onInput).toHaveBeenCalledWith("abc");
        expect(onResize.mock.calls).toStrictEqual([[50, 10]]);
        session.dispose();
    });

    it("exit: onExit с кодом (undefined → 0) один раз; после — ни вывода, ни ввода, ни ресайза", async () => {
        const { session, onInput, onResize } = make();
        const exits = vi.fn();
        session.onExit(exits);
        session.exit(undefined);
        session.exit(5);
        expect(exits.mock.calls).toStrictEqual([[0]]);
        expect(session.isExited).toBe(true);
        session.feed("late");
        session.write("x");
        session.resize(60, 12);
        await new Promise((r) => setTimeout(r, 20));
        expect(row(session, 0, 30)).toBe("");
        expect(onInput).not.toHaveBeenCalled();
        expect(onResize).not.toHaveBeenCalled();
        session.dispose();
    });

    it("exit с кодом отдаёт его как есть", () => {
        const { session } = make();
        const exits = vi.fn();
        session.onExit(exits);
        session.exit(3);
        expect(exits).toHaveBeenCalledWith(3);
        session.dispose();
    });

    it("ресайз: тот же размер — no-op; сменилась одна сторона — эмулятор и pty узнают", async () => {
        const { session, onResize } = make(); // 30x4
        session.resize(30, 4);
        session.resize(30, 6);
        session.resize(40, 6);
        session.resize(0, 6);
        session.resize(40, -1);
        expect(onResize.mock.calls).toStrictEqual([
            [30, 6],
            [40, 6],
        ]);
        // Эмулятор стал шире: строка в 35 символов не переносится.
        session.feed("x".repeat(35));
        await vi.waitFor(() => {
            expect(row(session, 0, 40)).toBe("x".repeat(35));
        });
        session.dispose();
    });

    it("курсор: позиция после вывода; строка до края (перенос ещё не случился) — курсора нет", async () => {
        const { session } = make(); // 30x4
        session.feed("abc\r\nde");
        await vi.waitFor(() => {
            expect(session.getCursor()).toStrictEqual({ x: 2, y: 1 });
        });
        session.feed(`\r${"y".repeat(30)}`);
        await vi.waitFor(() => {
            expect(session.getCursor()).toBeNull();
        });
        session.dispose();
    });

    it("мышь: без режима программы — молчит; с SGR-режимом — down/move/up уходят в pty", async () => {
        const { session, onInput } = make();
        expect(session.mouseEventsActive).toBe(false);
        session.sendMouse({ col: 1, row: 0, button: "left", action: "down", ctrl: false, alt: false, shift: false });
        expect(onInput).not.toHaveBeenCalled();
        session.feed("\u001b[?1003h\u001b[?1006h");
        await vi.waitFor(() => {
            expect(session.mouseEventsActive).toBe(true);
        });
        const press = { button: "left", ctrl: false, alt: false, shift: false } as const;
        session.sendMouse({ ...press, col: 2, row: 1, action: "down" });
        session.sendMouse({ ...press, col: 3, row: 1, action: "move" });
        session.sendMouse({ ...press, col: 3, row: 1, action: "up" });
        expect(onInput.mock.calls.map(([d]) => d)).toStrictEqual([
            "\u001b[<0;3;2M",
            "\u001b[<32;4;2M",
            "\u001b[<0;4;2m",
        ]);
        session.dispose();
    });
});
