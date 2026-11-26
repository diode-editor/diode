import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `TextEditor.revealRange` (#963): an extension scrolls the editor with each `TextEditorRevealType`. Every step waits
// for line 201 at its row of the frame; the cursor stays on line 1, the status bar shows it.

const textFile = resolve(repoRoot, "e2e", "fixtures", "reveal-range.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-reveal-range");
const ROWS = 30;
const TARGET = "row-201.";

async function expectTargetRow(editor: ScenarioDriver, row: (lines: readonly string[]) => boolean): Promise<void> {
    await editor.waitForText((text) => {
        const lines = text.split("\n").filter((line) => line.includes("row-"));
        return lines.some((line) => line.includes(TARGET)) && row(lines) && text.includes("Ln 1, Col 1");
    });
}

export default defineScenario({
    name: "extension-reveal-range",
    title: "TextEditor.revealRange: an extension scrolls the editor by each reveal type, the cursor stays",
    seedUserData: userData,
    open: [repoRoot, textFile],
    cols: 120,
    rows: ROWS,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    userKeybindings: [
        { key: "f6", command: "revealRange.default" },
        { key: "f7", command: "revealRange.inCenter" },
        { key: "f8", command: "revealRange.inCenterIfOutside" },
        { key: "f9", command: "revealRange.atTop" },
    ],
    async run(editor) {
        await editor.waitForText((text) => text.includes("row-1."));
        await editor.waitForReady();

        await editor.sendKey("F6");
        await expectTargetRow(editor, (lines) => lines.at(-1)?.includes(TARGET) === true);
        await editor.capture("default-minimal-scroll");

        await editor.sendKey("F9");
        await expectTargetRow(editor, (lines) => lines[0].includes(TARGET));
        await editor.capture("at-top");

        await editor.sendKey("F7");
        await expectTargetRow(editor, (lines) => {
            const index = lines.findIndex((line) => line.includes(TARGET));
            return index > 5 && index < lines.length - 5;
        });
        await editor.capture("in-center");

        // Already visible: stays where the previous step put it.
        await editor.sendKey("F8");
        await expectTargetRow(editor, (lines) => lines.findIndex((line) => line.includes(TARGET)) > 5);
        await editor.capture("in-center-if-outside-stays");
    },
});
