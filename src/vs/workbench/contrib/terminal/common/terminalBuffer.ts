/** The subset of xterm's `IBufferCell` that link detection and the selection read. */
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

/** xterm's `IMarker`: a buffer row that follows its line as the scrollback trims lines off the top. */
export interface ITerminalMarker {
    /** The row now; `-1` once the line is trimmed off. */
    readonly line: number;
    dispose(): void;
}

/** The emulator's active buffer: scrollback plus screen, rows are absolute and 0-based. */
export interface ITerminalBuffer {
    /** Full-screen programs (vim, less, htop) switch to the alternate buffer, which has no scrollback. */
    readonly type: "normal" | "alternate";
    readonly cols: number;
    /** Viewport height: xterm's `Terminal.rows`. */
    readonly rows: number;
    /** Absolute row of the viewport top: accounts for the scrollback offset. */
    readonly viewportY: number;
    readonly length: number;
    getLine(y: number): ITerminalBufferLine | undefined;
    /**
     * A marker on the cursor row (xterm `registerMarker(0)`); `undefined` on the alternate buffer, which has no
     * scrollback to trim.
     */
    registerMarker(): ITerminalMarker | undefined;
}
