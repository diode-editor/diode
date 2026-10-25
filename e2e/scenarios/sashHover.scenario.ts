import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "sash-hover",
    title: "Sash hover feedback",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // The sidebar sash sits on the editor part's first column.
        const editorPart = await editor.waitForNode("#editorPart");
        const sashX = editorPart.box.x;
        const midY = editorPart.box.y + Math.floor(editorPart.box.height / 2);
        const charAt = async (x: number, y: number): Promise<string> => {
            const frame = await editor.captureFrame();
            return frame.cells[y * frame.cols + x].char;
        };
        if ((await charAt(sashX, midY)) === "│") throw new Error("the sash is lit before the hover");

        // A move with no button held: `workbench.sash.hoverDelay` defaults to 0, so the line is up at once.
        await editor.sendMouse({ action: "move", x: sashX, y: midY });
        const lit = await charAt(sashX, midY);
        if (lit !== "│") throw new Error(`hovered sash shows ${JSON.stringify(lit)}, expected "│"`);
        await editor.capture("hovered");

        await editor.sendMouse({ action: "move", x: sashX + 10, y: midY });
        const out = await charAt(sashX, midY);
        if (out === "│") throw new Error("the sash stays lit after the cursor left");
    },
});
