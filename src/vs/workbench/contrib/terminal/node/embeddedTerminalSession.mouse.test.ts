import { describe, expect, it, vi } from "vitest";

import type {
    TerminalCell,
    TerminalMouseAction,
    TerminalMouseButton,
} from "@tuidom/core/common/iTerminalSurface";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Мышь проверяем сквозным путём на РЕАЛЬНОМ шелле:
//   sendMouse(семантика) → mapButton/mapAction → coreMouseService xterm → кодировщик SGR
//   → term.onData → pty.write → шелл.
// Шелл включает «report any motion» (?1003) + SGR-кодировку (?1006) и печатает всё, что
// пришло ему на stdin, через `cat -v` (ESC виден как `^[`). `stty -echo -icanon` убирает
// эхо драйвера и построчную буферизацию, иначе отчёт не дойдёт до cat без перевода строки.
const MOUSE_SHELL = 'stty -echo -icanon; printf "\\033[?1003h\\033[?1006h"; cat -v';

const COLS = 70;

function readRow(session: EmbeddedTerminalSession, row: number): string {
    const out: TerminalCell = { char: "", fg: 0, bg: 0, style: 0, width: 1 };
    let text = "";
    for (let x = 0; x < COLS; x++) {
        if (session.readCell(x, row, out)) text += out.char;
    }
    return text.trimEnd();
}

interface MouseCase {
    button: TerminalMouseButton;
    action: TerminalMouseAction;
    col: number;
    row: number;
    expected: string;
}

/**
 * Шлёт каждый кейс в сессию, разделяя отчёты переводом строки, и возвращает по строке
 * экрана на кейс. Порядок байтов в PTY гарантирован, поэтому достаточно дождаться
 * последней строки.
 */
async function collectReports(cases: readonly MouseCase[]): Promise<string[]> {
    const session = new EmbeddedTerminalSession({
        cols: COLS,
        rows: cases.length + 4,
        shell: "/bin/bash",
        args: ["-c", MOUSE_SHELL],
    });
    try {
        // Ждём, пока шелл реально включит mouse-режимы: до этого эмулятор отчёты не шлёт.
        await new Promise((resolve) => setTimeout(resolve, 700));
        for (const item of cases) {
            session.sendMouse({
                col: item.col,
                row: item.row,
                button: item.button,
                action: item.action,
                ctrl: false,
                alt: false,
                shift: false,
            });
            session.write("\n");
        }
        await vi.waitFor(
            () => {
                expect(readRow(session, cases.length - 1)).not.toBe("");
            },
            { timeout: 5000, interval: 25 },
        );
        return cases.map((_, index) => readRow(session, index));
    } finally {
        session.dispose();
    }
}

describe("EmbeddedTerminalSession — sendMouse", () => {
    it("разворачивает семантические button/action в отчёты xterm (SGR)", async () => {
        // SGR: ESC [ < <кнопка> ; <col+1> ; <row+1> M(нажатие)|m(отпускание).
        // Кнопки: left=0 middle=1 right=2; +32 — motion; колесо: up=64 down=65 left=66 right=67.
        // У "move" координаты уникальные: xterm глушит motion-события без смены позиции.
        const cases: MouseCase[] = [
            { button: "left", action: "down", col: 4, row: 2, expected: "^[[<0;5;3M" },
            { button: "middle", action: "down", col: 4, row: 2, expected: "^[[<1;5;3M" },
            { button: "right", action: "down", col: 4, row: 2, expected: "^[[<2;5;3M" },
            { button: "left", action: "up", col: 4, row: 2, expected: "^[[<0;5;3m" },
            // move без кнопки: NONE(3) + бит motion(32) = 35.
            { button: "none", action: "move", col: 9, row: 6, expected: "^[[<35;10;7M" },
            // drag: LEFT(0) + бит motion(32) = 32 (а не «ещё одно нажатие левой»).
            { button: "left", action: "move", col: 8, row: 5, expected: "^[[<32;9;6M" },
            { button: "wheel", action: "wheelUp", col: 4, row: 2, expected: "^[[<64;5;3M" },
            { button: "wheel", action: "wheelDown", col: 4, row: 2, expected: "^[[<65;5;3M" },
            { button: "wheel", action: "wheelLeft", col: 4, row: 2, expected: "^[[<66;5;3M" },
            { button: "wheel", action: "wheelRight", col: 4, row: 2, expected: "^[[<67;5;3M" },
        ];

        expect(await collectReports(cases)).toEqual(cases.map((c) => c.expected));
    }, 25000);

    it("пробрасывает модификаторы ctrl/alt/shift в отчёт", async () => {
        // Биты модификаторов SGR: shift=4, alt(meta)=8, ctrl=16 → left(0)+4+8+16 = 28.
        const session = new EmbeddedTerminalSession({
            cols: COLS,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", MOUSE_SHELL],
        });
        await new Promise((resolve) => setTimeout(resolve, 700));
        session.sendMouse({ col: 0, row: 0, button: "left", action: "down", ctrl: true, alt: true, shift: true });
        await vi.waitFor(
            () => {
                expect(readRow(session, 0)).toBe("^[[<28;1;1M");
            },
            { timeout: 5000, interval: 25 },
        );
        session.dispose();
    }, 25000);

    it("молча игнорирует мышь после выхода шелла", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 6,
            shell: "/bin/bash",
            args: ["-c", "exit 0"],
        });
        await new Promise<number>((resolve) => {
            session.onExit(resolve);
        });

        expect(() => {
            session.sendMouse({
                col: 1,
                row: 1,
                button: "left",
                action: "down",
                ctrl: false,
                alt: false,
                shift: false,
            });
        }).not.toThrow();
        session.dispose();
    }, 15000);
});
