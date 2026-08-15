/**
 * Минимальный парсер ANSI-вывода ровно под то, что эмитит наш TerminalRenderer
 * (`src/Rendering/TerminalRenderer.ts`) и `NodeTerminalBackend.renderFrame`
 * (`src/Backend/NodeTerminalBackend.ts`).
 *
 * Поддерживается ровно тот сабсет, который реально шлёт приложение:
 * - CSI `H` — абсолютное позиционирование курсора (1-based)
 * - CSI `m` — SGR: `0` reset, `1/2/3/4/7/9` стили, `38;2;r;g;b` truecolor fg,
 *   `48;2;r;g;b` truecolor bg, `39` reset fg, `49` reset bg
 * - CSI `2J` — clear screen
 * - CSI ? <num> h/l — DEC private modes (alt-screen, cursor visibility,
 *   synchronized output) — игнорируются
 * - Kitty `>11u`, `<u` — игнорируются
 *
 * `\n` и `\r` обрабатываются для устойчивости, но рендерер их не использует.
 */

import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";

export interface AnsiCell {
    char: string;
    fg: number;
    bg: number;
    style: number;
}

const SPACE_CELL: AnsiCell = { char: " ", fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, style: 0 };

export class AnsiScreen {
    public readonly width: number;
    public readonly height: number;
    private readonly cells: AnsiCell[][];
    private cursorX = 0;
    private cursorY = 0;
    private fg = DEFAULT_COLOR;
    private bg = DEFAULT_COLOR;
    private style = 0;

    public constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.cells = new Array<AnsiCell[]>(height);
        for (let y = 0; y < height; y++) {
            this.cells[y] = new Array<AnsiCell>(width);
            for (let x = 0; x < width; x++) this.cells[y][x] = { ...SPACE_CELL };
        }
    }

    public feed(input: string): void {
        let i = 0;
        while (i < input.length) {
            const ch = input[i];
            if (ch === "\x1b") {
                const consumed = this.handleEscape(input, i);
                if (consumed > 0) {
                    i += consumed;
                    continue;
                }
                // Unknown — skip the ESC byte.
                i++;
                continue;
            }
            if (ch === "\n") {
                this.cursorY = Math.min(this.cursorY + 1, this.height - 1);
                this.cursorX = 0;
                i++;
                continue;
            }
            if (ch === "\r") {
                this.cursorX = 0;
                i++;
                continue;
            }
            // Skip other C0 controls.
            const code = ch.charCodeAt(0);
            if (code < 0x20 || code === 0x7f) {
                i++;
                continue;
            }
            this.putChar(ch);
            i++;
        }
    }

    private putChar(ch: string): void {
        if (this.cursorY < 0 || this.cursorY >= this.height) return;
        if (this.cursorX < 0 || this.cursorX >= this.width) return;
        this.cells[this.cursorY][this.cursorX] = { char: ch, fg: this.fg, bg: this.bg, style: this.style };
        this.cursorX++;
        if (this.cursorX >= this.width) {
            // Авто-перенос мы НЕ делаем — рендерер всегда позиционирует курсор перед
            // каждой меняющейся ячейкой, а правую кромку обходит через CUP.
            this.cursorX = this.width - 1;
        }
    }

    /**
     * Returns the number of bytes consumed (including the leading ESC), or 0 if
     * the sequence is not recognized.
     */
    private handleEscape(input: string, start: number): number {
        // Need at least ESC + one more byte
        if (start + 1 >= input.length) return 0;
        const next = input[start + 1];

        // CSI sequence: ESC [ <params> <final>
        if (next === "[") {
            return this.handleCsi(input, start);
        }
        // DCS / OSC etc. — приложение их не использует кроме TMUX-обёртки,
        // которая в e2e не встречается. Просто съедаем ESC X ... ST.
        if (next === "P" || next === "]" || next === "X" || next === "^" || next === "_") {
            // Find ST (ESC \) or BEL.
            let i = start + 2;
            while (i < input.length) {
                if (input[i] === "\x07") return i - start + 1;
                if (input[i] === "\x1b" && i + 1 < input.length && input[i + 1] === "\\") return i - start + 2;
                i++;
            }
            return 0;
        }
        return 0;
    }

    private handleCsi(input: string, start: number): number {
        // input[start] = ESC, input[start+1] = '['
        let i = start + 2;
        let priv = "";
        // Optional private prefix `?`, `>`, `<`, `=`
        if (i < input.length && (input[i] === "?" || input[i] === ">" || input[i] === "<" || input[i] === "=")) {
            priv = input[i];
            i++;
        }
        // Parameters: digits and `;` and `:`
        let paramsStart = i;
        while (i < input.length) {
            const ch = input[i];
            if ((ch >= "0" && ch <= "9") || ch === ";" || ch === ":") {
                i++;
                continue;
            }
            break;
        }
        // Optional intermediate bytes
        while (i < input.length && input[i] >= " " && input[i] <= "/") {
            i++;
        }
        if (i >= input.length) return 0;
        const final = input[i];
        const paramsStr = input.slice(paramsStart, i - (i > paramsStart && input[i - 1] >= " " && input[i - 1] <= "/" ? 0 : 0));
        const consumed = i - start + 1;

        if (priv !== "") {
            // DEC private + kitty + others — ignore.
            return consumed;
        }

        const params = paramsStr.length > 0 ? paramsStr.split(";").map((s) => (s === "" ? 0 : Number.parseInt(s, 10))) : [];

        switch (final) {
            case "H":
            case "f": {
                const row = (params[0] ?? 1) - 1;
                const col = (params[1] ?? 1) - 1;
                this.cursorY = clamp(row, 0, this.height - 1);
                this.cursorX = clamp(col, 0, this.width - 1);
                return consumed;
            }
            case "J": {
                const mode = params[0] ?? 0;
                if (mode === 2 || mode === 3) {
                    this.clearAll();
                } else if (mode === 0) {
                    this.clearToEnd();
                }
                return consumed;
            }
            case "K": {
                // Erase in Line (EL)
                // Mode 0 (default): erase from cursor to end of line
                // Mode 1: erase from start of line to cursor
                // Mode 2: erase entire line
                const mode = params[0] ?? 0;
                if (mode === 0) {
                    for (let x = this.cursorX; x < this.width; x++) {
                        this.cells[this.cursorY][x] = { ...SPACE_CELL };
                    }
                } else if (mode === 1) {
                    for (let x = 0; x <= this.cursorX; x++) {
                        this.cells[this.cursorY][x] = { ...SPACE_CELL };
                    }
                } else if (mode === 2) {
                    for (let x = 0; x < this.width; x++) {
                        this.cells[this.cursorY][x] = { ...SPACE_CELL };
                    }
                }
                return consumed;
            }
            case "m": {
                this.applySgr(params);
                return consumed;
            }
            case "M": {
                // Delete Lines (DL) — delete N lines at current row, shifting lines up
                const count = params[0] ?? 1;
                const row = this.cursorY;
                const bottom = this.height - 1;
                for (let y = row; y <= bottom - count; y++) {
                    this.cells[y] = this.cells[y + count].map((c) => ({ ...c }));
                }
                for (let y = Math.max(row, bottom - count + 1); y <= bottom; y++) {
                    for (let x = 0; x < this.width; x++) this.cells[y][x] = { ...SPACE_CELL };
                }
                return consumed;
            }
            case "L": {
                // Insert Lines (IL) — insert N blank lines at current row, shifting lines down
                const count = params[0] ?? 1;
                const row = this.cursorY;
                const bottom = this.height - 1;
                for (let y = bottom; y >= row + count; y--) {
                    this.cells[y] = this.cells[y - count].map((c) => ({ ...c }));
                }
                for (let y = row; y < row + count && y <= bottom; y++) {
                    for (let x = 0; x < this.width; x++) this.cells[y][x] = { ...SPACE_CELL };
                }
                return consumed;
            }
            case "S": {
                // Scroll Up — scroll N lines up (top lines disappear, blanks appear at bottom)
                const count = params[0] ?? 1;
                for (let y = 0; y < this.height - count; y++) {
                    this.cells[y] = this.cells[y + count].map((c) => ({ ...c }));
                }
                for (let y = Math.max(0, this.height - count); y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) this.cells[y][x] = { ...SPACE_CELL };
                }
                return consumed;
            }
            case "T": {
                // Scroll Down — scroll N lines down (bottom lines disappear, blanks appear at top)
                const count = params[0] ?? 1;
                for (let y = this.height - 1; y >= count; y--) {
                    this.cells[y] = this.cells[y - count].map((c) => ({ ...c }));
                }
                for (let y = 0; y < count && y < this.height; y++) {
                    for (let x = 0; x < this.width; x++) this.cells[y][x] = { ...SPACE_CELL };
                }
                return consumed;
            }
            default:
                return consumed;
        }
    }

    private applySgr(params: number[]): void {
        if (params.length === 0) {
            this.resetSgr();
            return;
        }
        let i = 0;
        while (i < params.length) {
            const p = params[i];
            switch (p) {
                case 0:
                    this.resetSgr();
                    i++;
                    break;
                case 1:
                    this.style |= STYLE_BOLD;
                    i++;
                    break;
                case 2:
                    this.style |= STYLE_DIM;
                    i++;
                    break;
                case 3:
                    this.style |= STYLE_ITALIC;
                    i++;
                    break;
                case 4:
                    this.style |= STYLE_UNDERLINE;
                    i++;
                    break;
                case 7:
                    this.style |= STYLE_INVERSE;
                    i++;
                    break;
                case 9:
                    this.style |= STYLE_STRIKETHROUGH;
                    i++;
                    break;
                case 22:
                    this.style &= ~(STYLE_BOLD | STYLE_DIM);
                    i++;
                    break;
                case 23:
                    this.style &= ~STYLE_ITALIC;
                    i++;
                    break;
                case 24:
                    this.style &= ~STYLE_UNDERLINE;
                    i++;
                    break;
                case 27:
                    this.style &= ~STYLE_INVERSE;
                    i++;
                    break;
                case 29:
                    this.style &= ~STYLE_STRIKETHROUGH;
                    i++;
                    break;
                case 38:
                    if (params[i + 1] === 2 && i + 4 < params.length) {
                        this.fg = (params[i + 2] << 16) | (params[i + 3] << 8) | params[i + 4];
                        i += 5;
                    } else {
                        // 256-color or unsupported — skip the sub-arguments we can.
                        i = params.length;
                    }
                    break;
                case 39:
                    this.fg = DEFAULT_COLOR;
                    i++;
                    break;
                case 48:
                    if (params[i + 1] === 2 && i + 4 < params.length) {
                        this.bg = (params[i + 2] << 16) | (params[i + 3] << 8) | params[i + 4];
                        i += 5;
                    } else {
                        i = params.length;
                    }
                    break;
                case 49:
                    this.bg = DEFAULT_COLOR;
                    i++;
                    break;
                default:
                    i++;
                    break;
            }
        }
    }

    private resetSgr(): void {
        this.fg = DEFAULT_COLOR;
        this.bg = DEFAULT_COLOR;
        this.style = 0;
    }

    private clearAll(): void {
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) this.cells[y][x] = { ...SPACE_CELL };
        }
    }

    private clearToEnd(): void {
        for (let x = this.cursorX; x < this.width; x++) this.cells[this.cursorY][x] = { ...SPACE_CELL };
        for (let y = this.cursorY + 1; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) this.cells[y][x] = { ...SPACE_CELL };
        }
    }

    public cellAt(x: number, y: number): AnsiCell {
        return this.cells[y][x];
    }

    public lineText(y: number): string {
        let s = "";
        for (let x = 0; x < this.width; x++) s += this.cells[y][x].char;
        return s;
    }

    public toString(): string {
        const lines: string[] = [];
        for (let y = 0; y < this.height; y++) lines.push(this.lineText(y).replace(/\s+$/u, ""));
        return lines.join("\n");
    }

    /** Locate text on screen. Returns top-left coordinates of the first match or null. */
    public findText(text: string): { x: number; y: number } | null {
        for (let y = 0; y < this.height; y++) {
            const line = this.lineText(y);
            const x = line.indexOf(text);
            if (x >= 0) return { x, y };
        }
        return null;
    }
}

function clamp(value: number, lo: number, hi: number): number {
    if (value < lo) return lo;
    if (value > hi) return hi;
    return value;
}

export const STYLE_BOLD = 1 << 0;
export const STYLE_DIM = 1 << 1;
export const STYLE_ITALIC = 1 << 2;
export const STYLE_UNDERLINE = 1 << 3;
export const STYLE_INVERSE = 1 << 4;
export const STYLE_STRIKETHROUGH = 1 << 5;
