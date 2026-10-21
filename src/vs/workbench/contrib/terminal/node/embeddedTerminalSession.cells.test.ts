import { DEFAULT_COLOR, packRgb } from "@tuidom/core/common/colorUtils";
import type { TerminalCell } from "@tuidom/core/common/iTerminalSurface";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { describe, expect, it, vi } from "vitest";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Real node-pty + @xterm/headless: printf of exact VT sequences → grid via readCell.

function emptyCell(): TerminalCell {
    return { char: "", fg: 0, bg: 0, style: 0, width: 1 };
}

function readRow(session: EmbeddedTerminalSession, row: number, width: number): string {
    const out = emptyCell();
    let text = "";
    for (let x = 0; x < width; x++) {
        if (session.readCell(x, row, out)) text += out.char;
    }
    return text;
}

async function printed(script: string, marker: string): Promise<EmbeddedTerminalSession> {
    const session = new EmbeddedTerminalSession({
        cols: 40,
        rows: 6,
        shell: "/bin/bash",
        // sleep keeps the shell alive — otherwise it races with onExit and the cursor can't be read.
        args: ["-c", `printf '${script}'; sleep 5`],
    });
    await vi.waitFor(
        () => {
            expect(readRow(session, 0, 40)).toContain(marker);
        },
        { timeout: 5000, interval: 50 },
    );
    return session;
}

describe("EmbeddedTerminalSession — cell colors", () => {
    it("expands palette indices (SGR 38;5;n / 48;5;n) to RGB via the xterm table", async () => {
        // 196 = pure cube red (255,0,0), 21 = pure cube blue (0,0,255).
        const session = await printed("\\033[38;5;196m\\033[48;5;21mP\\033[0m", "P");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.fg).toBe(packRgb(255, 0, 0));
        expect(out.bg).toBe(packRgb(0, 0, 255));
        session.dispose();
    }, 15000);

    it("returns truecolor (SGR 38;2;r;g;b) as is", async () => {
        const session = await printed("\\033[38;2;10;20;30m\\033[48;2;40;50;60mT\\033[0m", "T");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.fg).toBe(packRgb(10, 20, 30));
        expect(out.bg).toBe(packRgb(40, 50, 60));
        session.dispose();
    }, 15000);

    it("16 ANSI colors (SGR 31/42/91) come from setAnsiColors; a change repaints existing output and fires onUpdate", async () => {
        const session = await printed("\\033[31;42mA\\033[91mB\\033[38;5;196mC\\033[0m", "ABC");
        const out = emptyCell();
        // Before setAnsiColors — the canonical xterm table.
        session.readCell(0, 0, out);
        expect(out.fg).toBe(packRgb(128, 0, 0));

        const ansi = Array.from({ length: 16 }, (_, i) => packRgb(i, i, i));
        const onUpdate = vi.fn();
        session.onUpdate(onUpdate);
        session.setAnsiColors(ansi);
        expect(onUpdate).toHaveBeenCalled();

        session.readCell(0, 0, out);
        expect(out.fg).toBe(packRgb(1, 1, 1)); // 31 → index 1
        expect(out.bg).toBe(packRgb(2, 2, 2)); // 42 → index 2
        session.readCell(1, 0, out);
        expect(out.fg).toBe(packRgb(9, 9, 9)); // 91 → index 9
        // The 6×6×6 cube stays canonical.
        session.readCell(2, 0, out);
        expect(out.fg).toBe(packRgb(255, 0, 0));
        session.dispose();
    }, 15000);

    it("returns DEFAULT_COLOR for a cell without explicit colors", async () => {
        const session = await printed("D", "D");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.fg).toBe(DEFAULT_COLOR);
        expect(out.bg).toBe(DEFAULT_COLOR);
        session.dispose();
    }, 15000);
});

describe("EmbeddedTerminalSession — cell styles", () => {
    it("builds a bitmask from all supported SGR attributes at once", async () => {
        // 1=bold 3=italic 4=underline 2=dim 7=inverse 9=strikethrough
        const session = await printed("\\033[1;3;4;2;7;9mS\\033[0m", "S");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.style).toBe(
            StyleFlags.Bold |
                StyleFlags.Italic |
                StyleFlags.Underline |
                StyleFlags.Dim |
                StyleFlags.Inverse |
                StyleFlags.Strikethrough,
        );
        session.dispose();
    }, 15000);

    it("returns an empty bitmask for a cell without attributes (all resolveStyle branches false)", async () => {
        const session = await printed("N", "N");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.style).toBe(StyleFlags.None);
        session.dispose();
    }, 15000);

    it.each([
        ["\\033[1m", StyleFlags.Bold],
        ["\\033[3m", StyleFlags.Italic],
        ["\\033[4m", StyleFlags.Underline],
        ["\\033[2m", StyleFlags.Dim],
        ["\\033[7m", StyleFlags.Inverse],
        ["\\033[9m", StyleFlags.Strikethrough],
    ])(
        "maps a single attribute %s to its flag",
        async (sgr, flag) => {
            const session = await printed(`${sgr}A\\033[0m`, "A");
            const out = emptyCell();

            expect(session.readCell(0, 0, out)).toBe(true);
            expect(out.style).toBe(flag);
            session.dispose();
        },
        15000,
    );
});

describe("EmbeddedTerminalSession — grid shape", () => {
    it("returns a wide char as a head with width=2 and false on the continuation cell", async () => {
        const session = await printed("世X", "世");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.char).toBe("世");
        expect(out.width).toBe(2);
        // x=1 is a continuation (getWidth() === 0), out stays untouched.
        expect(session.readCell(1, 0, out)).toBe(false);
        expect(session.readCell(2, 0, out)).toBe(true);
        expect(out.char).toBe("X");
        expect(out.width).toBe(1);
        session.dispose();
    }, 15000);

    it('returns a space for an empty cell within range (getChars() === "")', async () => {
        const session = await printed("ab", "ab");
        const out = emptyCell();

        // x=5 — the line exists, but the emulator wrote nothing there.
        expect(session.readCell(5, 0, out)).toBe(true);
        expect(out.char).toBe(" ");
        expect(out.width).toBe(1);
        session.dispose();
    }, 15000);

    it("returns false for x outside the line and for a missing line", async () => {
        const session = await printed("ab", "ab");
        const out = emptyCell();

        // The line exists, the column is beyond it → getCell() returns undefined.
        expect(session.readCell(1000, 0, out)).toBe(false);
        // No such line at all → getLine() returns undefined.
        expect(session.readCell(0, 1000, out)).toBe(false);
        session.dispose();
    }, 15000);
});

describe("EmbeddedTerminalSession — cursor", () => {
    it("returns null when the cursor is in pending wrap state (cursorX === cols)", async () => {
        // Exactly cols characters without a newline: xterm leaves the cursor at cols
        // (deferred wrap), i.e. outside the visible range 0..cols-1.
        const session = new EmbeddedTerminalSession({
            cols: 10,
            rows: 4,
            shell: "/bin/bash",
            args: ["-c", "printf '0123456789'; sleep 5"],
        });
        await vi.waitFor(
            () => {
                expect(readRow(session, 0, 10)).toBe("0123456789");
            },
            { timeout: 5000, interval: 50 },
        );

        expect(session.getCursor()).toBeNull();
        session.dispose();
    }, 15000);
});
