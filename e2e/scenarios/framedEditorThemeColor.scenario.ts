import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The editor group's frame is one color all around (docs/arch/workbench/Frames.md): Monokai sets its
// own `tab.border` (#1e1f1c, almost the background) apart from `panel.border` (#414339), and the
// tabs' boxes, their baseline and the corner ╮ — the frame's top — used to be the darker one.

const MONOKAI_PANEL_BORDER = 0x414339;

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "framed-editor-theme-color",
    title: "Editor group frame in Monokai: tabs, baseline and sides all in panel.border",
    open: [repoRoot, sampleFile],
    settings: { "workbench.colorTheme": "Monokai" },
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((text) => text.includes("greeting"));
        const strip = await editor.waitForNode("EditorTabStripElement");
        const frame = await editor.captureFrame();
        const cell = (x: number, y: number) => frame.cells[y * frame.cols + x];
        const { x, y } = strip.box;
        const baseline = y + strip.box.height - 1;
        const right = frame.cols - 1;

        const lines: [string, number, number, string][] = [
            ["tab ╭", x, y, "╭"],
            ["tab side", x, y + 1, "│"],
            ["corner ╮", right, baseline, "╮"],
            ["baseline", right - 1, baseline, "─"],
            ["left side", x, baseline + 1, "│"],
            ["right side", right, baseline + 1, "│"],
        ];
        for (const [name, cx, cy, char] of lines) {
            const c = cell(cx, cy);
            if (c?.char !== char)
                throw new Error(`${name}: expected "${char}" at ${cx},${cy}, got "${String(c?.char)}"`);
            if (c.fg !== MONOKAI_PANEL_BORDER) {
                throw new Error(`${name}: fg ${String(c.fg?.toString(16))}, expected Monokai panel.border 414339`);
            }
        }
        await editor.capture("monokai");
    },
});
