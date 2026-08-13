import { describe, expect, it, vi } from "vitest";

import type { TerminalCell } from "@tuidom/all/common/iTerminalSurface";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Тесты гоняют РЕАЛЬНЫЕ node-pty + @xterm/headless (linux, оба установлены). Чтобы
// вывод был детерминированным, спавним `/bin/bash -c "<script>"`, а не интерактивный шелл.

function readRow(session: EmbeddedTerminalSession, row: number, width: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < width; x++) {
        if (session.readCell(x, row, out)) text += out.char;
    }
    return text;
}

function awaitExit(session: EmbeddedTerminalSession): Promise<number> {
    return new Promise<number>((resolve) => {
        session.onExit(resolve);
    });
}

describe("EmbeddedTerminalSession", () => {
    it("captures shell output via readCell and reports the exit code", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "echo marker; exit 3"],
        });
        const exitCode = await awaitExit(session);
        expect(exitCode).toBe(3);
        await vi.waitFor(
            () => {
                expect(readRow(session, 0, 40)).toContain("marker");
            },
            { timeout: 5000, interval: 50 },
        );
        session.dispose();
    }, 15000);

    it("treats a same-size resize as a no-op safe to call after exit", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "exit 0"],
        });
        await awaitExit(session);
        expect(() => {
            session.resize(40, 6);
        }).not.toThrow();
        session.dispose();
    }, 15000);

    it("returns false for out-of-range readCell and stays safe on write after exit", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "exit 0"],
        });
        const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
        await awaitExit(session);
        expect(session.readCell(1000, 1000, out)).toBe(false);
        expect(session.readCell(0, -1, out)).toBe(false);
        expect(() => {
            session.write("ignored");
        }).not.toThrow();
        session.dispose();
    }, 15000);

    it("exposes an in-bounds cursor position while the shell is alive", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "printf hi; sleep 2"],
        });
        await vi.waitFor(
            () => {
                expect(readRow(session, 0, 40)).toContain("hi");
            },
            { timeout: 5000, interval: 50 },
        );
        const cursor = session.getCursor();
        expect(cursor).not.toBeNull();
        expect(cursor?.x).toBeGreaterThanOrEqual(0);
        expect(cursor?.x).toBeLessThan(40);
        expect(cursor?.y).toBeGreaterThanOrEqual(0);
        expect(cursor?.y).toBeLessThan(6);
        session.dispose();
    }, 15000);
});
