import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Explorer row cursor: the selection bar fills the row from the very left edge
// of the sidebar, while row content keeps its one-column inset (the inset lives
// inside TreeViewElement as `leftPadding`, not in an outer padding container).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "explorer-cursor",
    title: "Explorer cursor spans to the panel's left edge",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Focus the explorer via the View menu (Alt+V → "Explorer") — opening the
        // file above auto-revealed it, so the cursor sits on a nested tree row.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("sample.ts"));
        await editor.capture("nested-row");

        // Jump to the first row — a depth-0 node shows the same edge-to-edge bar.
        await editor.sendKey("Home");
        await editor.capture("top-row");
    },
});
