import { resolve } from "node:path";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The cursor shape is a terminal sequence (DECSCUSR), not a cell: the PNG shows no bar, so every step checks the
// shape in the frame snapshot. Multi-cursor with `line`: the secondaries stay cell blocks, the primary is only the
// hardware bar — in the PNG it is not visible (accepted in #887).

const tsFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const mdFile = resolve(repoRoot, "README.md");

async function expectShape(editor: ScenarioDriver, expected: string): Promise<void> {
    const { cursorStyle } = await editor.captureFrame();
    const actual = cursorStyle === null ? "terminal" : `${cursorStyle.shape}${cursorStyle.blinking ? "" : " steady"}`;
    if (actual !== expected) throw new Error(`cursor shape ${actual}, expected ${expected}`);
}

export default defineScenario({
    name: "cursor-style",
    title: "editor.cursorStyle: a bar in TypeScript, a block in Markdown, the terminal's shape in quick open",
    open: [repoRoot, tsFile, mdFile],
    cols: 140,
    rows: 30,
    settings: {
        "editor.cursorStyle": "line",
        "[markdown]": { "editor.cursorStyle": "block" },
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("README.md"));
        await expectShape(editor, "block");

        await editor.sendKey("Ctrl+\\");
        await editor.waitForNode("#editorGroup-2");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("1");
        await editor.sendKey("Ctrl+6"); // sample.ts in group 1
        await editor.waitForText((t) => t.includes("greeting"));
        await expectShape(editor, "bar");
        await editor.capture("split-bar-and-block");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("2");
        await expectShape(editor, "block");

        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await expectShape(editor, "terminal");
        await editor.capture("quick-open-terminal-shape");
        await editor.sendKey("Escape");
        await expectShape(editor, "block");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("1");
        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.waitForText((t) => t.includes("(3 selections)"));
        await expectShape(editor, "bar");
        await editor.capture("multi-cursor-bar");
    },
});
