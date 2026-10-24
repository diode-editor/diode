import { createWriteStream, mkdirSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario } from "./framework.ts";

// "Enable Editing" on a document on disk (docs/arch/Editor.md, docs/TODO/OpenPerformance.md 4.5): the toast's button
// streams the file into memory chunk by chunk, the status bar shows "Loading N%" and the document on disk stays on
// screen meanwhile; then the tab leaves read-only, an edit goes in, and Ctrl+S streams the buffer back to the file.

const LINES = 1_500_000;
const dir = join(tmpdir(), "diode-scenario-large-file-editing");
const file = join(dir, "editing.log");

/** nf-cod-lock — the read-only tab marker, see tuidom/ui/editorgroup/editorTabItemElement.ts. */
const LOCK = "";
const FIRST_LINE = "2026-01-01T00:00:00.000Z INFO diode-scenario-edit-start";
const EDIT = "EDITED ";

function line(i: number): string {
    if (i === 0) return FIRST_LINE;
    return `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i % 1000).padStart(3, "0")}Z INFO worker[${String(i % 8)}] request ${String(i)} handled in ${String(i % 90)}ms`;
}

/** ~130 MB, written in blocks: a string of that size is not worth building. */
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

/** The first bytes of the file on disk: what the save wrote. */
function head(length: number): string {
    const fd = openSync(file, "r");
    try {
        const bytes = Buffer.alloc(length);
        return bytes.subarray(0, readSync(fd, bytes, 0, length, 0)).toString("utf8");
    } finally {
        closeSync(fd);
    }
}

export default defineScenario({
    name: "large-file-editing",
    title: "Enable Editing on a large log: streamed into memory with progress, edited, saved",
    open: [file],
    cols: 120,
    rows: 32,
    timeoutMs: 600_000,
    prepare: generate,
    async run(editor) {
        await editor.waitForText((t) => t.includes(FIRST_LINE) && t.includes(LOCK) && t.includes("Enable Editing"));
        await editor.capture("read-only-toast");

        // F6 focuses the toast, Enter presses its button.
        await editor.sendKey("F6");
        await editor.sendKey("Enter");
        // Best effort: on a fast machine the load may be over before a frame is taken.
        try {
            await editor.waitForText((t) => /Loading \d+%/.test(t), { timeoutMs: 5_000, intervalMs: 20 });
            await editor.capture("loading");
        } catch {
            // The load finished first; the next frame proves it ended.
        }

        await editor.waitForText((t) => !t.includes(LOCK) && !/Loading \d+%/.test(t), { timeoutMs: 120_000 });
        await editor.capture("editable");

        await editor.sendKey("Ctrl+Home");
        await editor.sendText(EDIT);
        await editor.waitForText((t) => t.includes(`${EDIT}${FIRST_LINE}`));
        await editor.capture("edited");

        await editor.sendKey("Ctrl+s");
        // The dirty dot on the tab goes when the bytes are on disk.
        await editor.waitForText(() => head(EDIT.length + FIRST_LINE.length) === `${EDIT}${FIRST_LINE}`, {
            timeoutMs: 120_000,
        });
        const saved = await editor.captureFrame();
        if (frameToText(saved).includes(LOCK)) throw new Error("the tab went back to read-only after the save");
        await editor.capture("saved");
    },
});
