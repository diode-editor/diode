import { appendFileSync, createWriteStream, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario } from "./framework.ts";

// Follow (`tail -f`) of a document on disk (docs/arch/Editor.md, docs/TODO/OpenPerformance.md 4.4): lines a
// writer appends to the log are read as a tail — no re-indexing — and, with the cursor on the last line
// (Ctrl+End), the screen rides along; the status bar shows `Follow: On`. A cursor above the end leaves the
// screen where it is while the line count grows. Upstream has no follow for a file (a deviation): the closest
// analogs are the Output panel's auto scrolling and `less +F`.

const LINES = 300_000;
const dir = join(tmpdir(), "diode-scenario-large-file-follow");
const file = join(dir, "app.log");

const FIRST_LINE = "2026-01-01T00:00:00.000Z INFO diode-scenario-follow-start";
const APPENDED = ["alpha-appended-line", "beta-appended-line", "gamma-appended-line"];
const LATER = "delta-later-line";

function line(i: number): string {
    if (i === 0) return FIRST_LINE;
    return `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i % 1000).padStart(3, "0")}Z INFO worker[${String(i % 8)}] request ${String(i)} handled in ${String(i % 90)}ms`;
}

/** ~25 MB: above the 20 MiB threshold, so the file opens on disk. */
async function generate(): Promise<void> {
    mkdirSync(dir, { recursive: true });
    const stream = createWriteStream(file);
    let block: string[] = [];
    for (let i = 0; i < LINES; i++) {
        block.push(line(i));
        if (block.length >= 10_000) {
            const flushed = block.join("\n") + "\n";
            block = [];
            if (!stream.write(flushed)) await new Promise((resolve) => stream.once("drain", resolve));
        }
    }
    if (block.length > 0) stream.write(block.join("\n") + "\n");
    await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on("error", reject);
    });
}

/** The marker leads the line: the large-file toast covers the right half of the text until it is dismissed. */
function appendLines(lines: readonly string[]): void {
    appendFileSync(
        file,
        lines.map((text) => `${text} 2026-01-02T00:00:00.000Z INFO appended by the scenario`).join("\n") + "\n",
    );
}

export default defineScenario({
    name: "large-file-follow",
    title: "Large file on disk: follow — appended lines ride into view with the cursor on the last line",
    open: [file],
    cols: 120,
    rows: 32,
    timeoutMs: 300_000,
    prepare: generate,
    async run(editor) {
        await editor.waitForText((t) => t.includes(FIRST_LINE));
        await editor.waitForState("EditorElement", (state) => state?.lineCount === LINES + 1, { timeoutMs: 60_000 });
        await editor.waitForText((t) => t.includes("Follow: Off"));

        // Ctrl+End: the cursor is on the last line, follow is on.
        await editor.sendKey("Ctrl+End");
        await editor.waitForText((t) => t.includes(`Ln ${String(LINES + 1)}`) && t.includes("Follow: On"));

        // A writer appends three lines: they come into view and the cursor moves to the new last line.
        appendLines(APPENDED);
        await editor.waitForText(
            (t) => APPENDED.every((text) => t.includes(text)) && t.includes(`Ln ${String(LINES + 4)}`),
            { timeoutMs: 20_000 },
        );
        await editor.capture("following");

        // Reading the head: the cursor leaves the last line, follow is off, the screen stands while the file grows.
        await editor.sendKey("Ctrl+Home");
        await editor.waitForText((t) => t.includes(FIRST_LINE) && t.includes("Follow: Off"));
        appendLines([LATER]);
        await editor.waitForState("EditorElement", (state) => state?.lineCount === LINES + 5, { timeoutMs: 20_000 });
        const head = await editor.captureFrame();
        const headText = frameToText(head);
        if (!headText.includes(FIRST_LINE)) throw new Error("the screen left the head of the file");
        if (headText.includes(LATER)) throw new Error("a line appended while reading the head came into view");
        await editor.capture("cursor-above");

        // The status bar entry toggles follow back on: the cursor goes to the end and the new line is on screen.
        await editor.clickNode("#statusBarItem-status-largeFile-followTail");
        await editor.waitForText((t) => t.includes(LATER) && t.includes("Follow: On"));
        await editor.capture("toggled-on");
    },
});
