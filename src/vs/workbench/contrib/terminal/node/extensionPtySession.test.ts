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
});
