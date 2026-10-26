import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// #855: one Ctrl+S with `files.trimTrailingWhitespace`, `insertFinalNewline` and `trimFinalNewlines`
// writes the cleaned text; Ctrl+Z brings the whitespace back.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-trim-demo-"));
const sampleFile = join(sampleDir, "notes.txt");
const ORIGINAL = "foo  \nbar\t\nbaz   \n\n\n";
writeFileSync(sampleFile, ORIGINAL);

export default defineScenario({
    name: "trim-whitespace-on-save",
    title: "Save trims trailing whitespace and final newlines",
    open: [sampleDir, sampleFile],
    settings: {
        "files.trimTrailingWhitespace": true,
        "files.insertFinalNewline": true,
        "files.trimFinalNewlines": true,
    },
    cols: 80,
    rows: 16,
    async run(editor) {
        await editor.waitForText((t) => t.includes("baz"));
        await editor.capture("before-save");

        await editor.sendKey("Ctrl+S");
        await waitUntil(
            () => readFileSync(sampleFile, "utf-8"),
            (text) => text === "foo\nbar\nbaz\n",
            { describe: "trimmed notes.txt on disk" },
        );
        await editor.capture("saved");

        await editor.sendKey("Ctrl+Z");
        await editor.sendKey("Ctrl+Z");
        await editor.capture("undone");
    },
});
