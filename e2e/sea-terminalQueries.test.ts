import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import type { DiodeSession } from "./helpers/runDiode.ts";
import { usePtyApp } from "./helpers/useApp.ts";

/**
 * The terminal's reply arrives on the tty input: while the tty is in cooked mode with ECHO
 * (before `backend.setup()`), the kernel prints it to the screen, and `^[]10;rgb:…` garbage
 * stayed in the shell (v0.9.0). The test plays the terminal: queries go out only after entering
 * the alt screen (raw mode follows immediately), and the output has no echoed replies.
 */

// node-pty is unix-only in the current packaging (like the `terminal` scenario).
const describeUnix = process.platform === "win32" ? describe.skip : describe;

const ALT_SCREEN_ON = "\x1b[?1049h";
const ST = "\x1b\\";
const DA1_QUERY = "\x1b[c";
const HOST_BG_QUERY = `\x1b]11;?${ST}`;
/** OSC 10/11 (foreground/background), OSC 4;n (palette) and DA1. */
const QUERY = /\x1b\](10|11);\?\x1b\\|\x1b\]4;(\d+);\?\x1b\\|\x1b\[c/g;

/** Answers color and DA1 queries like a real terminal while the session is alive. */
function answerTerminalQueries(session: DiodeSession): () => void {
    // Everything before `scanned` is parsed; a tail shorter than the longest query is kept,
    // since a query may be cut at a chunk boundary and is completed on the next tick.
    let scanned = 0;
    const timer = setInterval(() => {
        const output = session.getRawOutput();
        const replies: string[] = [];
        let end = scanned;
        for (const match of output.slice(scanned).matchAll(QUERY)) {
            if (match[0] === DA1_QUERY) replies.push("\x1b[?62;52;c");
            else if (match[2] === undefined) replies.push(`\x1b]${match[1]};rgb:1e1e/1e1e/2e2e${ST}`);
            else replies.push(`\x1b]4;${match[2]};rgb:4545/4747/5a5a${ST}`);
            end = scanned + match.index + match[0].length;
        }
        scanned = Math.max(end, output.length - 16);
        if (replies.length > 0) session.write(replies.join(""));
    }, 2);
    return () => {
        clearInterval(timer);
    };
}

describeUnix("запросы к хост-терминалу — SEA", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("colorSource=host: запросы уходят после входа в raw-режим, ответы не печатаются эхом", async () => {
        const { session } = await usePtyApp({
            files: { "a.txt": "hello\n" },
            open: ["a.txt"],
            settings: { "terminal.integrated.colorSource": "host" },
        });
        const stop = answerTerminalQueries(session);
        try {
            await session.waitFor((s) => s.findText("hello") !== null);
            await expect.poll(() => session.getRawOutput().includes(HOST_BG_QUERY), { timeout: 10_000 }).toBe(true);
            // Let the replies arrive and (if the tty were in cooked mode) get echoed.
            await new Promise((resolve) => setTimeout(resolve, 300));
        } finally {
            stop();
        }
        const output = session.getRawOutput();
        // ECHOCTL prints ESC as `^[`: that's how the garbage in the shell looked after exit.
        expect(output).not.toContain("^[");
        const altScreen = output.indexOf(ALT_SCREEN_ON);
        expect(altScreen).toBeGreaterThanOrEqual(0);
        expect(output.indexOf(HOST_BG_QUERY)).toBeGreaterThan(altScreen);
        expect(output.indexOf(DA1_QUERY)).toBeGreaterThan(altScreen);

        await session.dispose();
        expect(session.isExited).toBe(true);
    }, 120_000);
});
