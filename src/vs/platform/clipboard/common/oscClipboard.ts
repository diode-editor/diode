import type { IClipboard } from "./iClipboard.ts";

/**
 * Clipboard implementation backed by an internal register, mirrored to the
 * system clipboard via the OSC 52 *write* escape sequence.
 *
 * Write path:
 *   OSC 52 format: \x1b]52;c;<base64-encoded-text>\x07
 *   Updates the internal buffer and emits the sequence so the host terminal's
 *   clipboard receives a copy (lets the user paste Diode-copied text into other apps).
 *
 * Read path:
 *   readText() returns the internal buffer immediately. We deliberately do NOT
 *   query the terminal (OSC 52 read): many terminals disable clipboard read for
 *   security (e.g. kitty), so the query gets no answer and the round-trip just
 *   hangs — especially over ssh/tmux. Pasting external-app content arrives instead
 *   through the terminal's own paste gesture (bracketed paste), handled elsewhere.
 *
 * See: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands
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
