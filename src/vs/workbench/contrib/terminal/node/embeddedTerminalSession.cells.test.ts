import { describe, expect, it, vi } from "vitest";

import { DEFAULT_COLOR, packRgb } from "@tuidom/all/common/colorUtils";
import type { TerminalCell } from "@tuidom/all/common/iTerminalSurface";
import { StyleFlags } from "@tuidom/all/common/styleFlags";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Тесты гоняют РЕАЛЬНЫЕ node-pty + @xterm/headless: печатаем точные VT-последовательности
// через `/bin/bash -c 'printf …'` и читаем разложенную эмулятором сетку через readCell.
// Так проверяется весь путь SGR → эмулятор → resolveFg/resolveBg/resolveStyle.

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

/** Спавнит шелл, печатающий `script`, и ждёт, пока `marker` появится в первой строке. */
async function printed(script: string, marker: string): Promise<EmbeddedTerminalSession> {
    const session = new EmbeddedTerminalSession({
        cols: 40,
        rows: 6,
        shell: "/bin/bash",
        // sleep держит шелл живым — иначе гонка с onExit и курсор уже не прочитать.
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

describe("EmbeddedTerminalSession — цвета ячеек", () => {
    it("разворачивает palette-индексы (SGR 38;5;n / 48;5;n) в RGB по таблице xterm", async () => {
        // 196 = чистый красный куба (255,0,0), 21 = чистый синий куба (0,0,255).
        const session = await printed("\\033[38;5;196m\\033[48;5;21mP\\033[0m", "P");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.fg).toBe(packRgb(255, 0, 0));
        expect(out.bg).toBe(packRgb(0, 0, 255));
        session.dispose();
    }, 15000);

    it("отдаёт truecolor (SGR 38;2;r;g;b) как есть", async () => {
        const session = await printed("\\033[38;2;10;20;30m\\033[48;2;40;50;60mT\\033[0m", "T");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.fg).toBe(packRgb(10, 20, 30));
        expect(out.bg).toBe(packRgb(40, 50, 60));
        session.dispose();
    }, 15000);

    it("отдаёт DEFAULT_COLOR для ячейки без явных цветов", async () => {
        const session = await printed("D", "D");
        const out = emptyCell();

        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.fg).toBe(DEFAULT_COLOR);
        expect(out.bg).toBe(DEFAULT_COLOR);
        session.dispose();
    }, 15000);
});

describe("EmbeddedTerminalSession — стили ячеек", () => {
    it("собирает битмаску из всех поддерживаемых SGR-атрибутов сразу", async () => {
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

    it("отдаёт пустую битмаску для ячейки без атрибутов (все ветки resolveStyle — false)", async () => {
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
        "разворачивает одиночный атрибут %s в свой флаг",
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

describe("EmbeddedTerminalSession — форма сетки", () => {
    it("отдаёт wide-char головой width=2 и false на continuation-ячейке", async () => {
        const session = await printed("世X", "世");
        const out = emptyCell();

        // Голова wide-char на x=0.
        expect(session.readCell(0, 0, out)).toBe(true);
        expect(out.char).toBe("世");
        expect(out.width).toBe(2);
        // x=1 — continuation (getWidth() === 0), out не трогаем.
        expect(session.readCell(1, 0, out)).toBe(false);
        // Следующий обычный символ читается нормально.
        expect(session.readCell(2, 0, out)).toBe(true);
        expect(out.char).toBe("X");
        expect(out.width).toBe(1);
        session.dispose();
    }, 15000);

    it('отдаёт пробел для пустой ячейки внутри диапазона (getChars() === "")', async () => {
        const session = await printed("ab", "ab");
        const out = emptyCell();

        // x=5 — строка есть, но эмулятор туда ничего не писал.
        expect(session.readCell(5, 0, out)).toBe(true);
        expect(out.char).toBe(" ");
        expect(out.width).toBe(1);
        session.dispose();
    }, 15000);

    it("отдаёт false для x вне строки и для отсутствующей строки", async () => {
        const session = await printed("ab", "ab");
        const out = emptyCell();

        // Строка существует, столбец за её пределами → getCell() отдаёт undefined.
        expect(session.readCell(1000, 0, out)).toBe(false);
        // Строки нет вовсе → getLine() отдаёт undefined.
        expect(session.readCell(0, 1000, out)).toBe(false);
        session.dispose();
    }, 15000);
});

describe("EmbeddedTerminalSession — курсор", () => {
    it("отдаёт null, когда курсор в состоянии pending wrap (cursorX === cols)", async () => {
        // Ровно cols символов без перевода строки: xterm оставляет курсор на cols
        // (отложенный перенос), т.е. за пределами видимого диапазона 0..cols-1.
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
