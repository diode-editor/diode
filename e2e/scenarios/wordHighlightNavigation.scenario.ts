import { resolve } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `greeting` in the fixture: declaration (Ln 2, Col 7) and usage (Ln 5, Col 12).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

/**
 * Occurrences are painted after the frame (upstream `WordHighlighter.runDelayer`): wait until the
 * word after `return ` on Ln 5 gets a background other than `return` itself, or loses it.
 */
async function waitForUsageHighlight(editor: ScenarioDriver, highlighted: boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
        const frame = await editor.captureFrame();
        for (let y = 0; y < frame.rows; y++) {
            const x = frameLine(frame, y).indexOf("return ");
            if (x < 0) continue;
            const bg = (col: number) => frame.cells[y * frame.cols + col]?.bg;
            if ((bg(x + "return ".length) !== bg(x)) === highlighted) return;
        }
        if (Date.now() > deadline) {
            throw new Error(`the word after \`return\` is ${highlighted ? "not " : ""}highlighted`);
        }
        await new Promise((r) => setTimeout(r, 50));
    }
}

export default defineScenario({
    name: "word-highlight-navigation",
    title: "F7 / Shift+F7: jump between occurrences of the word under the cursor",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 8; i++) await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 2, Col 9"));
        await waitForUsageHighlight(editor, true);
        await editor.capture("caret-on-word");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Ln 5, Col 12"));
        await editor.capture("next-highlight");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Ln 2, Col 7"));
        await editor.capture("next-wraps");

        await editor.sendKey("Shift+F7");
        await editor.waitForText((t) => t.includes("Ln 5, Col 12"));
        await editor.capture("previous-wraps");

        // Typing drops the highlight (upstream `_stopAll`): a query would light up `xgreeting`.
        await editor.sendText("x");
        await editor.waitForText((t) => t.includes("return xgreeting"));
        await waitForUsageHighlight(editor, false);
        await editor.capture("typing-drops-highlight");

        // Undo is an edit too; the next explicit move brings the highlight back.
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("return greeting"));
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Ln 5, Col 13"));
        await waitForUsageHighlight(editor, true);
        await editor.capture("explicit-move-restores");
    },
});
