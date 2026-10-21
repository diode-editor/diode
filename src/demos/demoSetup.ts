/**
 * Deliberate copy of tuidom/demos/demoSetup.ts: the demos directory is not part of the tuidom npm package.
 */

export const stdin = process.stdin;
export const stdout = process.stdout;

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
 * Input modes go without tmux passthrough: tmux tracks them per pane, while passthrough would enable
 * the mode in the outer terminal globally and leak the key encoding into other panes.
 */
export function writeDirect(sequence: string): void {
    stdout.write(sequence);
}

const extraCleanup: (() => void)[] = [];

export function addCleanup(fn: () => void): void {
    extraCleanup.push(fn);
}

export function cleanup(): void {
    for (const fn of extraCleanup) fn();
    writeDirect(KITTY_DISABLE);
    stdin.setRawMode(false);
}

export function isCtrlC(ctrlKey: boolean, key: string): boolean {
    return ctrlKey && key === "c";
}

export function exitOnCtrlC(ctrlKey: boolean, key: string): void {
    if (isCtrlC(ctrlKey, key)) {
        process.exit(0);
    }
}

export function exitOnCtrlCToken(token: { kind: string; letter?: string; key?: string; ctrlKey?: boolean }): void {
    const isLegacy = token.kind === "ctrl-char" && token.letter === "c";
    const isKitty = token.kind === "csi-u" && token.ctrlKey === true && token.key === "c";
    if (isLegacy || isKitty) {
        process.exit(0);
    }
}

stdin.setRawMode(true);
stdin.setEncoding("utf8");
stdin.resume();

writeDirect(KITTY_ENABLE);

process.on("exit", cleanup);
