import { describe, expect, it, vi } from "vitest";

import { EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";
import { ExtensionPtySession } from "./extensionPtySession.ts";

// `onLineData` (upstream `LineDataEventAddon`) over a real @xterm/headless: the line stream task problem
// matchers read. An extension pty and a shell must give the same lines.

function make(cols = 30) {
    const session = new ExtensionPtySession({
        cols,
        rows: 4,
        name: "t",
        onInput: () => undefined,
        onResize: () => undefined,
    });
    const lines: string[] = [];
    session.onLineData((line) => lines.push(line));
    const exits: number[] = [];
    session.onExit((code) => {
        // The lines seen at the moment of the exit event.
        exits.push(code, lines.length);
    });
    return { session, lines, exits };
}

function flush(session: ExtensionPtySession): Promise<void> {
    // An empty write resolves after everything written before it is parsed.
    return new Promise((resolve) => {
        session.printMessage("");
        setTimeout(resolve, 20);
    });
}

describe("XtermSurface — output lines (onLineData)", () => {
    it("a line is reported at its line feed; escape sequences are not part of it", async () => {
        const { session, lines } = make();
        session.feed("\u001b[31msrc/a.ts(3,5)\u001b[0m: error TS1: x\r\nsecond");
        await vi.waitFor(() => {
            expect(lines).toStrictEqual(["src/a.ts(3,5): error TS1: x"]);
        });
        session.feed("\r\n");
        await vi.waitFor(() => {
            expect(lines).toStrictEqual(["src/a.ts(3,5): error TS1: x", "second"]);
        });
        session.dispose();
    });

    it("rows wrapped by the terminal width are one line", async () => {
        const { session, lines } = make(10);
        const long = "abcdefghij".repeat(2) + "klmno";
        // Spaces at the end of a wrapped row are part of the line.
        const spaced = "abc       xyz";
        session.feed(`${long}\r\nnext\r\n${spaced}\r\n`);
        await vi.waitFor(() => {
            expect(lines).toStrictEqual([long, "next", spaced]);
        });
        session.dispose();
    });

    it("a wide character that does not fit wraps and leaves its cell blank in the line, as upstream", async () => {
        const { session, lines } = make(10);
        session.feed("abcdefghi中x\r\n");
        await vi.waitFor(() => {
            expect(lines).toStrictEqual(["abcdefghi 中x"]);
        });
        session.dispose();
    });

    it("the unterminated last line is reported on exit, before the exit event", async () => {
        const { session, lines, exits } = make();
        session.feed("first\r\nlast without newline");
        session.exit(2);
        await vi.waitFor(() => {
            expect(exits).toStrictEqual([2, 2]);
        });
        expect(lines).toStrictEqual(["first", "last without newline"]);
        session.dispose();
    });

    it("an empty last line is not reported on exit", async () => {
        const { session, lines, exits } = make();
        session.feed("only\r\n");
        session.exit(0);
        await vi.waitFor(() => {
            expect(exits).toStrictEqual([0, 1]);
        });
        expect(lines).toStrictEqual(["only"]);
        session.dispose();
    });

    it("the line feed that later ends the flushed line does not report it again", async () => {
        const { session, lines, exits } = make();
        session.feed("tail");
        session.exit(1);
        await vi.waitFor(() => {
            expect(exits).toStrictEqual([1, 1]);
        });
        // A reused task terminal: the new process starts on a new line.
        session.relaunch({});
        session.feed("next\r\n");
        await vi.waitFor(() => {
            expect(lines).toStrictEqual(["tail", "next"]);
        });
        await flush(session);
        expect(lines).toStrictEqual(["tail", "next"]);
        session.dispose();
    });

    it("after a clearing relaunch the first line on the flushed row is reported", async () => {
        const { session, lines, exits } = make();
        session.feed("tail");
        session.exit(1);
        await vi.waitFor(() => {
            expect(exits).toStrictEqual([1, 1]);
        });
        session.relaunch({ clear: true });
        session.feed("fresh\r\n");
        await vi.waitFor(() => {
            expect(lines).toStrictEqual(["tail", "fresh"]);
        });
        session.dispose();
    });

    it("a shell process gives the same lines, the last one before its exit", async () => {
        const session = new EmbeddedTerminalSession({
            cols: 40,
            rows: 4,
            shell: "/bin/sh",
            args: ["-c", "printf 'one\\ntwo'"],
        });
        const lines: string[] = [];
        session.onLineData((line) => lines.push(line));
        const seenAtExit = await new Promise<string[]>((resolve) => {
            session.onExit(() => {
                resolve([...lines]);
            });
        });
        expect(seenAtExit).toStrictEqual(["one", "two"]);
        session.dispose();
    }, 20000);
});
