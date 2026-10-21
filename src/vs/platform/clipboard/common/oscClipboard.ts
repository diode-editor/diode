import type { IClipboard } from "./iClipboard.ts";

/**
 * Reads come from the internal buffer, deliberately NOT an OSC 52 query: many terminals
 * disable clipboard read (kitty), so the round-trip just hangs, especially over ssh/tmux.
 * External content arrives via bracketed paste instead.
 */

export class OscClipboard implements IClipboard {
    private buffer = "";
    private readonly writeFn: (seq: string) => void;

    public constructor(writeFn: (seq: string) => void) {
        this.writeFn = writeFn;
    }

    public writeText(text: string): Promise<void> {
        this.buffer = text;
        const encoded = Buffer.from(text, "utf8").toString("base64");
        this.writeFn(`\x1b]52;c;${encoded}\x07`);
        return Promise.resolve();
    }

    public readText(): Promise<string> {
        return Promise.resolve(this.buffer);
    }
}
