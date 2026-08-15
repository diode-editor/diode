/**
 * Shared setup for low-level TUI demos (raw stdin, Kitty protocol).
 * Осознанная копия tuidom/demos/demoSetup.ts: демки diode не тянут демо-каталог
 * библиотеки (он не входит в npm-пакет tuidom).
 *
 * Handles:
 * - Kitty Keyboard Protocol enable/disable
 * - TMUX passthrough
 * - Raw mode setup
 * - Cleanup on exit
 * - Ctrl+C exit
 */

export const stdin = process.stdin;
export const stdout = process.stdout;

// ── Kitty Keyboard Protocol ──────────────────────────────────────
export const KITTY_ENABLE = "\x1b[>15u";
export const KITTY_DISABLE = "\x1b[<u";

const isTmux = process.env.TMUX != null && process.env.TMUX !== "";

export function wrapForTmux(sequence: string): string {
    // eslint-disable-next-line no-control-regex
    const escaped = sequence.replace(/\x1b/g, "\x1b\x1b");
    return `\x1bPtmux;${escaped}\x1b\\`;
}

export function writePassthrough(sequence: string): void {
    stdout.write(isTmux ? wrapForTmux(sequence) : sequence);
}

/**
 * Write a sequence straight to stdout without TMUX passthrough. Use for input-mode
 * sequences (Kitty keyboard protocol) so tmux manages them per-pane — passthrough would
 * force the mode onto the outer terminal globally and leak key encoding into other panes.
 */
export function writeDirect(sequence: string): void {
    stdout.write(sequence);
}

// ── Setup raw mode + Kitty ───────────────────────────────────────

const extraCleanup: (() => void)[] = [];

export function addCleanup(fn: () => void): void {
    extraCleanup.push(fn);
}

export function cleanup(): void {
    for (const fn of extraCleanup) fn();
    writeDirect(KITTY_DISABLE);
    stdin.setRawMode(false);
}

/** Returns true if the event is Ctrl+C (check before processing other events). */
export function isCtrlC(ctrlKey: boolean, key: string): boolean {
    return ctrlKey && key === "c";
}

export function exitOnCtrlC(ctrlKey: boolean, key: string): void {
    if (isCtrlC(ctrlKey, key)) {
        process.exit(0);
    }
}

/** For tokenize-level demos that get raw RawTerminalTokens (handles both legacy ctrl-char and Kitty csi-u). */
export function exitOnCtrlCToken(token: { kind: string; letter?: string; key?: string; ctrlKey?: boolean }): void {
    const isLegacy = token.kind === "ctrl-char" && token.letter === "c";
    const isKitty = token.kind === "csi-u" && token.ctrlKey === true && token.key === "c";
    if (isLegacy || isKitty) {
        process.exit(0);
    }
}

// ── Init ─────────────────────────────────────────────────────────

stdin.setRawMode(true);
stdin.setEncoding("utf8");
stdin.resume();

writeDirect(KITTY_ENABLE);

process.on("exit", cleanup);
