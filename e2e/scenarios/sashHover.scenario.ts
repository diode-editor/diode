import { resolve } from "node:path";

import { findNode } from "../helpers/inspectorClient.ts";

import { defineScenario, repoRoot } from "./framework.ts";

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

// Framed parts: the sidebar sash lies over both frame lines at the boundary (the sidebar frame's right line and the
// editor group frame's left line). The lines already show the boundary, so a hover lights no line over them; only the
// mouse pointer turns into the resize arrow. The pointer (OSC 22) is not in the frame — workbench.sashHover.test.ts
// checks it; here the frame must stay the same through the hover.
export default defineScenario({
    name: "sash-hover",
    title: "Sash hover feedback",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // The sidebar sash: the two columns just left of and on the editor part's first column.
        const editorPart = await editor.waitForNode("#editorPart");
        const midY = editorPart.box.y + Math.floor(editorPart.box.height / 2);
        const sash = findNode(
            (await editor.getDocument()).root,
            (node) =>
                node.type === "SashElement" &&
                node.box.width === 2 &&
                node.box.x === editorPart.box.x - 1 &&
                node.box.y <= midY &&
                midY < node.box.y + node.box.height,
        );
        if (sash === null)
            throw new Error(`no 2-cell sash over columns ${String(editorPart.box.x - 1)}..${String(editorPart.box.x)}`);
        const cells = [sash.box.x, sash.box.x + 1];

        const look = async (): Promise<string[]> => {
            const frame = await editor.captureFrame();
            return cells.map((x) => {
                const cell = frame.cells[midY * frame.cols + x];
                return `${cell.char}:${String(cell.fg)}`;
            });
        };
        const before = await look();
        if (before.some((cell) => !cell.startsWith("│:"))) {
            throw new Error(`the sash cells show ${JSON.stringify(before)}, expected the two frame lines "│"`);
        }

        // A move with no button held: `workbench.sash.hoverDelay` defaults to 0, so a hover line would be up at once.
        for (const x of cells) {
            await editor.sendMouse({ action: "move", x, y: midY });
            const hovered = await look();
            if (JSON.stringify(hovered) !== JSON.stringify(before)) {
                throw new Error(
                    `hovering the sash at ${String(x)} changed it: ${JSON.stringify(before)} → ${JSON.stringify(hovered)}`,
                );
            }
        }
        await editor.capture("hovered");

        await editor.sendMouse({ action: "move", x: cells[0] + 10, y: midY });
        const out = await look();
        if (JSON.stringify(out) !== JSON.stringify(before)) {
            throw new Error(`the sash changed after the cursor left: ${JSON.stringify(out)}`);
        }
    },
});
