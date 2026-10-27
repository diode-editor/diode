import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The line between editor groups has a cell of its own: │ in a column for side-by-side groups, ─ in a row once the
// layout is toggled. Its color is editorGroup.border; hovering it switches to sash.hoverBorder.

const file = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "editor-group-separator",
    title: "Editor group separator: │ between side-by-side groups, ─ between stacked ones",
    open: [repoRoot, file],
    cols: 120,
    rows: 30,
    async run(editor) {
        await editor.waitForText((t) => t.includes("sample.ts"));

        await editor.sendKey("Ctrl+\\");
        await editor.waitForNode("#editorGroup-2");
        const left = await editor.waitForNode("#editorGroup-1");
        const separatorX = left.box.x + left.box.width;
        await editor.waitForText((t) => t.split("\n")[left.box.y + 3]?.[separatorX] === "│");
        await editor.capture("columns");

        // Toggle the layout axis via the palette: Shift+Alt+0 works only on kitty/csi-u.
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText(">Toggle Vertical/Horizontal");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("─".repeat(40)));
        await editor.capture("rows");
    },
});
