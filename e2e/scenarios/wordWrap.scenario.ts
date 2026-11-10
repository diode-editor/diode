import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// A copy of the fixture: the last step rewrites it from outside, as git checkout or a formatter would.
const sampleDir = mkdtempSync(join(tmpdir(), "diode-word-wrap-demo-"));
const sampleFile = join(sampleDir, "wordWrap.ts");

/** Lines that came from disk, in the middle of the file: wrapped at once, without toggling Alt+Z (#1098). */
const RELOADED = Array.from(
    { length: 2 },
    (_, i) => `export const reloaded${i} = "a long line written by another program while wrap is on, wrapped right away — RELOAD_TAIL_${i}";`,
);

export default defineScenario({
    name: "word-wrap",
    title: "Word wrap: Alt+Z wraps long lines at the viewport edge, lines reloaded from disk too",
    open: [sampleDir, sampleFile],
    cols: 80,
    rows: 20,
    async prepare() {
        // Short lines on top: the reloaded ones take the places of lines that did not wrap. Short lines below:
        // the file overflows the viewport before and after the reload, so no scrollbar change rewraps it anyway.
        const fixture = readFileSync(resolve(repoRoot, "e2e", "fixtures", "wordWrap.ts"), "utf8");
        const tail = Array.from({ length: 20 }, (_, i) => `// tail ${String(i)}`).join("\n");
        writeFileSync(sampleFile, `// a\n// b\n// c\n${fixture}${tail}\n`);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("word-wrap fixture"));
        await editor.capture("no-wrap");

        await editor.sendKey("Alt+Z");
        await editor.waitForText((t) => t.includes("WRAP_TAIL_MARKER"));
        await editor.capture("wrapped");

        await editor.sendKey("Alt+Z");
        await editor.waitForText((t) => !t.includes("WRAP_TAIL_MARKER"));
        await editor.capture("unwrapped");

        await editor.sendKey("Alt+Z");
        await editor.waitForText((t) => t.includes("WRAP_TAIL_MARKER"));
        const lines = readFileSync(sampleFile, "utf8").split("\n");
        writeFileSync(sampleFile, [lines[0], ...RELOADED, ...lines.slice(1)].join("\n"));
        await editor.waitForText((t) => t.includes("RELOAD_TAIL_0") && t.includes("RELOAD_TAIL_1"));
        await editor.capture("reloaded-wrapped");
    },
});
