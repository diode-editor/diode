import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { describe, expect, it, vi } from "vitest";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

const COLS = 40;
const ROWS = 6;

function readRow(session: EmbeddedTerminalSession, row: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < COLS; x++) {
        if (session.readCell(x, row, out)) text += out.char;
    }
    return text.trimEnd();
}

/** The shell stays alive — otherwise it races with onExit. */
async function withOutput(count: number): Promise<EmbeddedTerminalSession> {
    const session = new EmbeddedTerminalSession({
        cols: COLS,
        rows: ROWS,
        shell: "/bin/bash",
        args: ["-c", `seq 1 ${count}; sleep 10`],
    });
    await vi.waitFor(
        () => {
            expect(readRow(session, ROWS - 2)).toBe(String(count));
        },
        { timeout: 5000, interval: 25 },
    );
    return session;
}

describe("EmbeddedTerminalSession — вьюпорт и скролбэк", () => {
    it("после scrollLines показывает историю, а не дно вывода", async () => {
        const session = await withOutput(50);
        try {
            expect(session.scrollOffset).toBe(0);

            session.scrollLines(-10);
            expect(session.scrollOffset).toBe(10);
            // The bottom (offset=0) showed …50 on the second-to-last row; after scrolling 10 lines
            // up, the same row must show 40.
            expect(readRow(session, ROWS - 2)).toBe("40");

            session.scrollLines(10);
            expect(session.scrollOffset).toBe(0);
            expect(readRow(session, ROWS - 2)).toBe("50");
        } finally {
            session.dispose();
        }
    }, 20000);

    it("клампит смещение: ниже дна и выше начала скролбэка не уезжает", async () => {
        const session = await withOutput(20);
        try {
            session.scrollLines(5); // down from the bottom — nowhere to go
            expect(session.scrollOffset).toBe(0);

            session.scrollLines(-10_000); // up past the start of history
            expect(session.scrollOffset).toBeGreaterThan(0);
            expect(readRow(session, 0)).toBe("1"); // top of scrollback — the first output line
        } finally {
            session.dispose();
        }
    }, 20000);

    it("прячет курсор, пока смотрим в скролбэк", async () => {
        const session = await withOutput(30);
        try {
            expect(session.getCursor()).not.toBeNull();
            session.scrollLines(-3);
            expect(session.getCursor()).toBeNull();
            session.scrollLines(3);
            expect(session.getCursor()).not.toBeNull();
        } finally {
            session.dispose();
        }
    }, 20000);

    it("возвращает вьюпорт на дно при вводе", async () => {
        const session = await withOutput(30);
        try {
            session.scrollLines(-5);
            expect(session.scrollOffset).toBe(5);
            session.write("x");
            expect(session.scrollOffset).toBe(0);
        } finally {
            session.dispose();
        }
    }, 20000);

    it("возвращает вьюпорт на дно при новом выводе", async () => {
        // The shell prints history, waits, and prints one more line — the second output batch
        // arrives after we've scrolled into scrollback.
        const session = new EmbeddedTerminalSession({
            cols: COLS,
            rows: ROWS,
            shell: "/bin/bash",
            args: ["-c", "seq 1 30; sleep 1; echo tail; sleep 10"],
        });
        try {
            await vi.waitFor(
                () => {
                    expect(readRow(session, ROWS - 2)).toBe("30");
                },
                { timeout: 5000, interval: 25 },
            );
            session.scrollLines(-5);
            expect(session.scrollOffset).toBe(5);

            await vi.waitFor(
                () => {
                    expect(readRow(session, ROWS - 2)).toBe("tail");
                },
                { timeout: 5000, interval: 25 },
            );
            expect(session.scrollOffset).toBe(0);
        } finally {
            session.dispose();
        }
    }, 20000);

    it("дёргает onUpdate, когда смещение реально изменилось", async () => {
        const session = await withOutput(30);
        try {
            let updates = 0;
            const sub = session.onUpdate(() => {
                updates++;
            });
            session.scrollLines(-2);
            expect(updates).toBe(1);
            session.scrollLines(2);
            expect(updates).toBe(2);
            session.scrollLines(2); // already at the bottom — no event
            expect(updates).toBe(2);
            sub.dispose();
        } finally {
            session.dispose();
        }
    }, 20000);

    it("mouseEventsActive: false у обычного шелла, true когда программа включила режим", async () => {
        const session = new EmbeddedTerminalSession({
            cols: COLS,
            rows: ROWS,
            shell: "/bin/bash",
            args: ["-c", 'sleep 0.3; printf "\\033[?1003h"; sleep 10'],
        });
        try {
            expect(session.mouseEventsActive).toBe(false);
            await vi.waitFor(
                () => {
                    expect(session.mouseEventsActive).toBe(true);
                },
                { timeout: 5000, interval: 25 },
            );
        } finally {
            session.dispose();
        }
    }, 20000);
});
