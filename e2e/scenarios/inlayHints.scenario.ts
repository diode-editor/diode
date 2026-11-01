import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `demo-inlay-hints` registers `vscode.languages.registerInlayHintsProvider` for typescript: a type after the
// variable name and a parameter name before the argument. The toggle command hides the hints and brings them back;
// an edit carries a hint along with its text until the next answer.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-inlay-hints-"));
const tsFile = join(sampleDir, "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-inlay-hints");

const TS = `const total = add(1, 2);
`;

export default defineScenario({
    name: "inlay-hints",
    title: "Extension inlay hints: a type after a name and a parameter before an argument, a toggle hides them",
    seedUserData: userData,
    open: [sampleDir, tsFile],
    cols: 80,
    rows: 16,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J: F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [{ key: "alt+j", command: "diode.editor.inlayHints.toggle" }],
    async prepare() {
        writeFileSync(tsFile, TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("const total : number = add(left: 1, 2);"), { timeoutMs: 20_000 });
        await editor.capture("hints");

        await editor.waitForReady();
        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("const total = add(1, 2);"));
        await editor.capture("toggled off");

        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("const total : number = add(left: 1, 2);"));

        // The caret is at the start of the file: the hints move with the text pushed right.
        await editor.sendText("  ");
        await editor.waitForText((t) => t.includes("  const total : number = add(left: 1, 2);"));
        await editor.capture("after an edit");

        // From column 2 to the argument: the block caret stands on "1", not on the parameter hint before it.
        for (let i = 0; i < "const total = add(".length; i++) await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Col 21"));
        await editor.capture("caret on the argument");
    },
});
