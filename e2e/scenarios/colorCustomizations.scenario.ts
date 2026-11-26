import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// `workbench.colorCustomizations`: a global override, a `[Light Modern]` block that waits for its theme,
// `"default"` (the registry default under the theme's own color) and removal — each edit of settings.json
// repaints at once, as a theme switch does.

const DARK_MODERN_EDITOR = 0x1f1f1f;
const REGISTRY_DARK_EDITOR = 0x1e1e1e;
const CUSTOM_DARK = 0x202020;
const CUSTOM_LIGHT = 0xfff8e0;

const sampleDir = mkdtempSync(join(tmpdir(), "diode-color-customizations-"));
const textFile = join(sampleDir, "notes.txt");
const settingsFile = join(sampleDir, ".diode", "settings.json");

function writeSettings(settings: Record<string, unknown>): void {
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 4)}\n`);
}

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

const CUSTOMIZATIONS = {
    "editor.background": "#202020",
    "[Light Modern]": { "editor.background": "#fff8e0" },
};

export default defineScenario({
    name: "color-customizations",
    title: "workbench.colorCustomizations: global and per-theme overrides, applied on every settings.json edit",
    open: [sampleDir, textFile],
    cols: 100,
    rows: 24,
    async prepare() {
        mkdirSync(join(sampleDir, ".diode"), { recursive: true });
        writeFileSync(textFile, "Theme colors overridden from settings.json.\n");
        writeSettings({ "workbench.colorTheme": "Dark Modern", "workbench.colorCustomizations": CUSTOMIZATIONS });
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("overridden from settings"));
        await waitForEditorBackground(editor, CUSTOM_DARK);
        await editor.capture("dark-custom");

        writeSettings({ "workbench.colorTheme": "Light Modern", "workbench.colorCustomizations": CUSTOMIZATIONS });
        await waitForEditorBackground(editor, CUSTOM_LIGHT);
        await editor.capture("light-block");

        writeSettings({
            "workbench.colorTheme": "Dark Modern",
            "workbench.colorCustomizations": { ...CUSTOMIZATIONS, "editor.background": "default" },
        });
        await waitForEditorBackground(editor, REGISTRY_DARK_EDITOR);

        writeSettings({ "workbench.colorTheme": "Dark Modern" });
        await waitForEditorBackground(editor, DARK_MODERN_EDITOR);
        await editor.capture("removed");
    },
});
