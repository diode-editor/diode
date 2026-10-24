import { createWriteStream, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario } from "./framework.ts";

// The document on disk (docs/arch/Editor.md, docs/TODO/OpenPerformance.md 4.2): above the size threshold
// (20 MiB) the file is not read into memory. The first screen comes from the first 4 MiB; the line index is
// built in the background, the status bar shows "Indexing N%" and the line count grows until the end of the
// file, which Ctrl+End then reaches by reading its last page. The large-file toast is the same as in 4.1.

const LINES = 2_400_000;
const dir = join(tmpdir(), "diode-scenario-large-file-on-disk");
const file = join(dir, "server.log");

/** nf-cod-lock — the read-only tab marker, see tuidom/ui/editorgroup/editorTabItemElement.ts. */
const LOCK = "";
const FIRST_LINE = "2026-01-01T00:00:00.000Z INFO diode-scenario-log-start";
const LAST_LINE = `2026-01-01T23:59:59.999Z INFO diode-scenario-log-end line=${String(LINES - 1)}`;

function line(i: number): string {
    if (i === 0) return FIRST_LINE;
    if (i === LINES - 1) return LAST_LINE;
    return `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i % 1000).padStart(3, "0")}Z INFO worker[${String(i % 8)}] request ${String(i)} handled in ${String(i % 90)}ms`;
}

/** ~200 MB, written in blocks: a string of that size cannot be built. */
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

export default defineScenario({
    name: "large-file-on-disk",
    title: "Large file on disk: first screen at once, the index grows in the background, Ctrl+End reads the end",
    open: [file],
    cols: 120,
    rows: 32,
    timeoutMs: 600_000,
    prepare: generate,
    async run(editor) {
        await editor.waitForText((t) => t.includes(FIRST_LINE) && t.includes(LOCK));
        // Best effort: the index of 200 MB takes a moment, and the status bar shows it while it runs.
        await editor.capture("first-screen");

        // The line count grows until the file ends: LINES lines plus the empty one after the final `\n`.
        await editor.waitForState("EditorElement", (state) => state?.lineCount === LINES + 1, {
            timeoutMs: 120_000,
        });
        const indexed = await editor.captureFrame();
        if (frameToText(indexed).includes("Indexing "))
            throw new Error("the status bar still shows the index as running");
        await editor.waitForText((t) => t.includes("Enable Editing"));
        await editor.capture("indexed");

        // Typing is blocked: the document on disk is read-only.
        await editor.sendText("ZZZ");
        const blocked = await editor.captureFrame();
        if (frameToText(blocked).includes("ZZZ")) throw new Error("typing reached the read-only document on disk");

        // The end of the file comes from its last page, not from memory. The toast covers the tail of the
        // line, so the check is its timestamp plus the status bar's line number.
        await editor.sendKey("Ctrl+End");
        await editor.waitForText(
            (t) =>
                t.includes(LAST_LINE.slice(0, "2026-01-01T23:59:59.999Z".length)) &&
                t.includes(`Ln ${String(LINES + 1)}`),
        );
        await editor.capture("end-of-file");

        // Find walks the lines in the background (OpenPerformance 4.3). A query on every line stops at the
        // upstream limit right away: "1 of 19999+".
        await editor.sendKey("Ctrl+F");
        await editor.sendText("request");
        await editor.waitForText((t) => t.includes("of 19999+"));
        await editor.capture("find-capped");

        // A query that matches nowhere: "Searching…" while the 2.4 M lines are walked, "No results" at the end.
        // Escape leaves the cursor on the current match; Ctrl+F seeds the query from that selection and selects
        // it in the input, so typing replaces it.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+F");
        await editor.sendText("zzz");
        await editor.waitForText((t) => t.includes("Searching…"));
        await editor.capture("find-searching");
        await editor.waitForText((t) => t.includes("No results"), { timeoutMs: 120_000 });

        // The walk starts at the cursor: from the end of the file it wraps to the top at once, and the lone
        // match on the first line is current as soon as the wrap reaches it; the editor reveals it.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("Ctrl+F");
        await editor.sendText("log-start");
        // The widget covers the tail of the first line: the top of the file is recognised by its fourth line.
        await editor.waitForText((t) => t.includes("1 of 1") && t.includes("request 3 handled in 3ms"), {
            timeoutMs: 120_000,
        });
        await editor.capture("find-lone-match");
    },
});
