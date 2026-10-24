/** The subset of xterm's `IBufferCell` that link detection reads. */
export interface ITerminalBufferCell {
    getWidth(): number;
    getChars(): string;
}

/** The subset of xterm's `IBufferLine`; a structural match, so an xterm line is passed as is. */
export interface ITerminalBufferLine {
    /** The line continues the previous one (soft wrap at the right edge). */
    readonly isWrapped: boolean;
    getCell(x: number): ITerminalBufferCell | undefined;
    translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

/** The emulator's active buffer: scrollback plus screen, rows are absolute and 0-based. */
export interface ITerminalBuffer {
    readonly cols: number;
    /** Absolute row of the viewport top: accounts for the scrollback offset. */
    readonly viewportY: number;
    readonly length: number;
    getLine(y: number): ITerminalBufferLine | undefined;
}
