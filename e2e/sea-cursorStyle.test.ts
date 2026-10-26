import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import type { DiodeSession } from "./helpers/runDiode.ts";
import { usePtyApp } from "./helpers/useApp.ts";

/**
 * `editor.cursorStyle` (#887) as the terminal sees it: the DECSCUSR bytes (`CSI n q`) on the tty.
 * Unset, diode never writes one — the user's own terminal shape stays; set, the shape goes out on
 * focus changes only, and Quit hands the shell back its default shape (`CSI 0 q`).
 */

// node-pty is unix-only in the current packaging (like the `terminal` scenario).
const describeUnix = process.platform === "win32" ? describe.skip : describe;

const DECSCUSR = /\x1b\[(\d*) q/g;
const ALT_SCREEN_OFF = "\x1b[?1049l";
const F1 = "\x1bOP";
const CTRL_P = "\x10";
const ESCAPE = "\x1b";
const ARROW_RIGHT = "\x1b[C";
const ARROW_LEFT = "\x1b[D";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The DECSCUSR parameters written since the previous call, in order. */
function decscusrReader(session: DiodeSession): () => string[] {
    let mark = 0;
    return () => {
        const output = session.getRawOutput();
        const params = [...output.slice(mark).matchAll(DECSCUSR)].map((m) => m[1] ?? "");
        mark = output.length;
        return params;
    };
}

/** Quit via the command palette (the stock binding is `mod+q`), then wait for the process to leave. */
async function quit(session: DiodeSession): Promise<void> {
    session.write(F1);
    await session.waitFor((s) => s.findText(">") !== null);
    session.write("Quit");
    await session.waitFor((s) => s.findText("Ctrl+Q") !== null);
    session.write("\r");
    await expect.poll(() => session.isExited, { timeout: 30_000 }).toBe(true);
}

/** Typing-free steps (a dirty buffer would stop Quit with "Save changes?"): caret moves, quick open and back. */
async function walk(session: DiodeSession, read: () => string[]): Promise<Record<string, string[]>> {
    const steps: Record<string, string[]> = {};
    await session.waitFor((s) => s.findText("const b") !== null, { timeoutMs: 30_000 });
    steps.start = read();
    session.write(ARROW_RIGHT);
    session.write(ARROW_LEFT);
    await sleep(500);
    steps.caretMoves = read();
    session.write(CTRL_P);
    await sleep(1000);
    steps.quickOpen = read();
    session.write(ESCAPE);
    await sleep(500);
    steps.backInEditor = read();
    const before = session.getRawOutput().length;
    await quit(session);
    steps.quit = read();
    expect(session.getRawOutput().slice(before)).toContain(ALT_SCREEN_OFF);
    return steps;
}

describeUnix("editor.cursorStyle on the tty (DECSCUSR) — SEA", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    const files = { "a.ts": "const a = 1;\nconst b = 2;\n" };

    it("unset: not a single DECSCUSR byte from start to Quit", async () => {
        const { session } = await usePtyApp({ files, open: ["a.ts"], cols: 120, rows: 30 });
        const steps = await walk(session, decscusrReader(session));

        expect(steps).toEqual({ start: [], caretMoves: [], quickOpen: [], backInEditor: [], quit: [] });
    }, 120_000);

    it("line: a bar once, the terminal's shape in quick open, the bar back, and CSI 0 q on Quit", async () => {
        const { session } = await usePtyApp({
            files,
            open: ["a.ts"],
            cols: 120,
            rows: 30,
            settings: { "editor.cursorStyle": "line" },
        });
        const steps = await walk(session, decscusrReader(session));

        const { quit: quitting, ...rest } = steps;
        expect(rest).toEqual({ start: ["5"], caretMoves: [], quickOpen: ["0"], backInEditor: ["5"] });
        // The palette that runs Quit has the terminal's shape too; whatever comes before teardown, it ends on 0.
        expect(quitting.at(-1)).toBe("0");
    }, 120_000);
});
