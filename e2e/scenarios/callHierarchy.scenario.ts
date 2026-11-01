import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `demo-call-hierarchy` registers `vscode.languages.registerCallHierarchyProvider` for typescript. Shift+Alt+H shows
// who calls `render` in the References panel, the title button switches to what it calls, Enter goes to the location.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-call-hierarchy-"));
const tsFile = join(sampleDir, "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-call-hierarchy");

const TS = `function render() {
    measure();
}
function measure() {
    return 1;
}
function paint() {
    render();
}

function update() {
    render();
}
`;

export default defineScenario({
    name: "call-hierarchy",
    title: "Call hierarchy: callers of a function in the References panel, the direction switch, Enter jumps",
    seedUserData: userData,
    open: [sampleDir, tsFile],
    cols: 90,
    rows: 20,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J: F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix. The title button does the same with the mouse.
    userKeybindings: [{ key: "alt+j", command: "references-view.showOutgoingCalls" }],
    async prepare() {
        writeFileSync(tsFile, TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("function render"), { timeoutMs: 20_000 });
        await editor.waitForReady();
        // The caret goes from the start of the line onto the name.
        for (let i = 0; i < "function ".length; i++) await editor.sendKey("ArrowRight");

        await editor.waitForReady();
        await editor.sendKey("Shift+Alt+h");
        await editor.waitForText((t) => t.includes("Callers Of") && t.includes("paint") && t.includes("update"), {
            timeoutMs: 20_000,
        });
        await editor.capture("callers of render");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Ln 8, Col 5"));
        await editor.capture("Enter jumps to the call in paint");

        // The tree reroots on the selected row: what `paint` calls.
        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("Calls From") && t.includes("paint") && t.includes("render"));
        await editor.capture("calls from paint");
    },
});
