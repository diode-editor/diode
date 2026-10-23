import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// `window.autoDetectColorScheme`: the terminal reports a light/dark flip (mode 2031, as when the OS switches
// appearance), and the editor moves to the preferred theme of that scheme — and back.

const DARK_MODERN_EDITOR = 0x1f1f1f;
const LIGHT_MODERN_EDITOR = 0xffffff;

const sampleDir = mkdtempSync(join(tmpdir(), "diode-auto-color-scheme-"));
const textFile = join(sampleDir, "notes.txt");

/** A cell in the empty editor area, right of the text and above the status bar. */
function editorBackground(frame: GridSnapshot): number | undefined {
    return frame.cells[Math.floor(frame.rows / 2) * frame.cols + Math.floor(frame.cols * 0.75)]?.bg;
}

async function waitForEditorBackground(editor: ScenarioDriver, expected: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
        const bg = editorBackground(await editor.captureFrame());
        if (bg === expected) return;
        if (Date.now() > deadline) {
            throw new Error(`editor background ${String(bg?.toString(16))}, expected ${expected.toString(16)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

export default defineScenario({
    name: "auto-detect-color-scheme",
    title: "Color theme follows the terminal's light/dark scheme (window.autoDetectColorScheme)",
    open: [sampleDir, textFile],
    settings: {
        "window.autoDetectColorScheme": true,
        "workbench.preferredDarkColorTheme": "Dark Modern",
        "workbench.preferredLightColorTheme": "Light Modern",
    },
    cols: 100,
    rows: 24,
    async prepare() {
        writeFileSync(textFile, "The OS switched to light mode, and so did the editor.\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("so did the editor"));
        await waitForEditorBackground(editor, DARK_MODERN_EDITOR);
        await editor.capture("dark");

        await editor.setHostColorScheme("light");
        await waitForEditorBackground(editor, LIGHT_MODERN_EDITOR);
        await editor.capture("light");

        await editor.setHostColorScheme("dark");
        await waitForEditorBackground(editor, DARK_MODERN_EDITOR);
    },
});
