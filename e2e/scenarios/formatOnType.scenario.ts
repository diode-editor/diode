import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `on-type-spaces` registers `vscode.languages.registerOnTypeFormattingEditProvider` for plaintext, where no bundled
// server competes, and the fixture turns `editor.formatOnType` on: `;` puts spaces around the `=` of its line.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-format-on-type-"));
const textFile = join(sampleDir, "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-on-type-formatting");

/** Key presses, not `sendText`: that goes as a bracketed paste, which doesn't count as typing, as in VS Code. */
async function typeKeys(editor: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const char of text) await editor.sendKey(char);
}

export default defineScenario({
    name: "format-on-type",
    title: "Format on type: the trigger formats the line, undo takes the format back, the caret stays after the trigger",
    seedUserData: userData,
    open: [sampleDir, textFile],
    cols: 80,
    rows: 14,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(textFile, "\n");
    },
    async run(editor) {
        await editor.waitForReady();

        await typeKeys(editor, "int x=1");
        await editor.waitForText((t) => t.includes("int x=1"));
        await editor.capture("before-the-trigger");

        await typeKeys(editor, ";");
        await editor.waitForText((t) => t.includes("int x = 1;"));
        await editor.capture("formatted-after-the-semicolon");

        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("int x=1;"));
        await editor.capture("undo-takes-the-format-back");

        await editor.sendKey("Ctrl+Y");
        await editor.waitForText((t) => t.includes("int x = 1;"));

        // The next character lands after the trigger, not inside the line.
        await typeKeys(editor, "y");
        await editor.waitForText((t) => t.includes("int x = 1;y"));
        await editor.capture("the-caret-stayed-after-it");
    },
});
