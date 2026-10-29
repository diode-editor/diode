import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// The folders are expanded by clicks, no file is opened: on the Windows CI runner auto-reveal of an opened
// src/app/main.ts left src/app collapsed or moved the cursor off it.
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "indentGuides");

const GUIDE = "│";

/** Guides left of the label on the Explorer row with `label`: `[column, …]`. */
function guidesBefore(frame: GridSnapshot, label: string): number[] {
    for (let y = 0; y < frame.rows; y++) {
        const row = frame.cells.slice(y * frame.cols, (y + 1) * frame.cols);
        const text = row.map((cell) => cell.char).join("");
        const at = text.indexOf(` ${label}`);
        // The Explorer is the leftmost occurrence: the editor tab and breadcrumbs sit to the right.
        if (at < 0 || at > 30) continue;
        return row.flatMap((cell, x) => (x < at && cell.char === GUIDE ? [x] : []));
    }
    throw new Error(`no Explorer row "${label}"`);
}

/** Waits until every row has as many guides as expected (a mouse move repaints on the next frame). */
async function expectGuides(editor: ScenarioDriver, expected: Record<string, number>): Promise<void> {
    const mismatch = (frame: GridSnapshot): string | null => {
        for (const [label, count] of Object.entries(expected)) {
            const actual = guidesBefore(frame, label).length;
            if (actual !== count) return `row "${label}": ${actual} guides, expected ${count}`;
        }
        return null;
    };
    const deadline = Date.now() + 5000;
    for (;;) {
        const error = mismatch(await editor.captureFrame());
        if (error === null) return;
        if (Date.now() > deadline) throw new Error(error);
    }
}

export default defineScenario({
    name: "explorer-indent-guides",
    title: "workbench.tree.renderIndentGuides: the active guide always, the rest while the mouse is over the tree",
    open: [sampleDir],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("src") && t.includes("README.md"));
        // Rows: src, app, main.ts, util.ts, index.ts, README.md. Indent 1, chevron, space: a name at depth d
        // starts at column 3 + 2d.
        await editor.clickNode("TreeViewElement", { dx: 4, dy: 0 });
        await editor.waitForText((t) => t.includes("app") && t.includes("index.ts"));
        await editor.clickNode("TreeViewElement", { dx: 6, dy: 1 });
        await editor.waitForText((t) => t.includes("util.ts"));

        // The cursor is on the expanded app, so its own guide is the active one. Without the mouse over the
        // tree: only that bright guide, through main.ts and util.ts.
        await editor.sendMouse({ action: "move", x: 70, y: 10 });
        await expectGuides(editor, { app: 0, "main.ts": 1, "util.ts": 1, "index.ts": 0 });
        await editor.capture("active-only");

        // The pointer over the empty area below the rows: the dim guide of src appears too.
        const tree = await editor.waitForNode("TreeViewElement");
        const { x, y, height } = tree.box;
        await editor.sendMouse({ action: "move", x: x + 5, y: y + height - 1 });
        await expectGuides(editor, { app: 1, "main.ts": 2, "util.ts": 2, "index.ts": 1 });
        await editor.capture("hover");

        // The pointer leaves for the editor: only the active guide stays.
        await editor.sendMouse({ action: "move", x: 70, y: 10 });
        await expectGuides(editor, { app: 0, "main.ts": 1, "util.ts": 1, "index.ts": 0 });
        await editor.capture("mouse-left");
    },
});
