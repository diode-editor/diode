import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `decoration-hover` gives the name after each `const` a `hoverMessage`, puts a Git Blame-shaped `after` text with its
// own `hoverMessage` at the end of the line (an empty range at column MAX_SAFE_INTEGER) and a diagnostic over the
// line. Show Hover (Ctrl+K Ctrl+U) on the name: the diagnostic, then the name's block; at the line end: the
// diagnostic, then the blame's block. A plain-text file: no hover provider answers.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-decoration-hover-"));
const file = join(sampleDir, "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-decoration-hover");

const TEXT = ["const answer = 42", "plain line", ""].join("\n");

export default defineScenario({
    name: "extension-decoration-hover",
    title: "hoverMessage of extension decorations in Show Hover: a name in the line, a blame after its end",
    seedUserData: userData,
    open: [sampleDir, file],
    cols: 80,
    rows: 12,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(file, TEXT);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("const answer = 42  Ann, 2 days ago"), { timeoutMs: 20_000 });
        await editor.waitForReady();

        // The caret on the name.
        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < 8; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText((t) => t.includes("Prefer let") && t.includes("answer is a decorated name"));
        await editor.capture("name");

        // The caret at the line end: the blame's hover.
        await editor.sendKey("Escape");
        await editor.sendKey("End");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+U");
        await editor.waitForText(
            (t) => t.includes("Prefer let") && t.includes("git blame feat: add answer") && !t.includes("decorated name"),
        );
        await editor.capture("blame");
    },
});
