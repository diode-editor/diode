import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

// The mouse pointer itself (OSC 22: ew-resize over the sash and for the whole drag) is not in
// the frame; workbenchLayoutElement.pointerShape.test.ts checks it. This shows the gesture.
export default defineScenario({
    name: "sash-pointer-shape",
    title: "Side Bar sash: hover, drag, release",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // The sidebar sash sits on the editor part's first column.
        let part = await editor.waitForNode("#editorPart");
        const sashX = part.box.x;
        const midY = part.box.y + Math.floor(part.box.height / 2);
        await editor.sendMouse({ action: "move", button: "none", x: sashX, y: midY });
        await editor.capture("hover");

        await editor.sendMouse({ action: "press", button: "left", x: sashX, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: sashX + 10, y: midY + 4 });
        await editor.capture("dragging");

        await editor.sendMouse({ action: "release", button: "left", x: sashX + 14, y: midY + 4 });
        part = await editor.waitForNode("#editorPart");
        if (part.box.x !== sashX + 10) throw new Error(`editor part at column ${part.box.x}, expected ${sashX + 10}`);
        await editor.capture("released");
    },
});
