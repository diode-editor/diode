import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `TextEditor.options.cursorStyle` (#888): an extension switches the cursor like vim modes, a block in normal mode and
// a bar in insert mode. The shape is a terminal sequence (DECSCUSR), not a cell: the PNG shows no bar, so every step
// checks the shape in the frame snapshot. Keys are user keybindings for the demo extension's two commands.

const tsFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-cursor-modes");

/** The extension's style arrives over RPC after the key: poll the frame for it. */
async function expectShape(editor: ScenarioDriver, expected: string): Promise<void> {
    let actual = "";
    for (let attempt = 0; attempt < 50; attempt++) {
        const { cursorStyle } = await editor.captureFrame();
        actual = cursorStyle === null ? "terminal" : cursorStyle.shape;
        if (actual === expected) return;
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    throw new Error(`cursor shape ${actual}, expected ${expected}`);
}

export default defineScenario({
    name: "extension-cursor-style",
    title: "TextEditor.options.cursorStyle: an extension's normal mode is a block, insert a bar, the split keeps its own",
    seedUserData: userData,
    open: [repoRoot, tsFile],
    cols: 140,
    rows: 30,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    settings: { "editor.cursorStyle": "line" },
    userKeybindings: [
        { key: "f7", command: "cursorModes.normal" },
        { key: "f8", command: "cursorModes.insert" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.waitForReady();
        await expectShape(editor, "bar");

        await editor.sendKey("Ctrl+\\");
        await editor.waitForNode("#editorGroup-2");
        await editor.sendKey("F7");
        await expectShape(editor, "block");
        await editor.capture("normal-mode-block");

        // The first group's editor was not touched: it keeps editor.cursorStyle.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("1");
        await expectShape(editor, "bar");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("2");
        await expectShape(editor, "block");

        await editor.sendKey("F8");
        await expectShape(editor, "bar");
        await editor.capture("insert-mode-bar");
    },
});
