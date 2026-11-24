import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Every part sits in a rounded frame (docs/arch/workbench/Frames.md): tabs are the top of their
// group's frame, sidebar sections are bands between lines, and a sash lies over both frame lines
// at a boundary.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "framed-workbench",
    title: "Framed workbench: part frames, boxed tabs, sidebar bands, two-line sashes",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    userKeybindings: [{ key: "ctrl+alt+d", command: "workbench.view.debug" }],
    async run(editor) {
        let screen: string[] = [];
        const seen =
            (predicate: (rows: string[]) => boolean) =>
            (text: string): boolean => {
                screen = text.split("\n");
                return predicate(screen);
            };

        // Row 0 is the menu bar; the sidebar frame opens on row 1, the active tab opens into the editor on row 3.
        await editor.waitForText(seen((rows) => rows.join("\n").includes("greeting")));
        if (!screen[1].startsWith("╭")) throw new Error(`no sidebar frame:\n${screen.join("\n")}`);
        if (!screen[3].includes("╯") && !screen[3].includes("│ ")) {
            throw new Error(`no tab baseline on row 3:\n${screen.join("\n")}`);
        }
        await editor.capture("explorer");

        // The panel in a frame of its own under the editor group's.
        await editor.sendKey("Ctrl+J");
        await editor.waitForText(seen((rows) => rows.some((row) => row.includes("PROBLEMS"))));
        await editor.capture("panel");

        // Two groups side by side: two frames, the boundary is their two lines.
        await editor.sendKey("Ctrl+\\");
        await editor.waitForText(seen((rows) => rows[5].split("││").length >= 3));
        await editor.capture("split");

        // Run and Debug: the container header and every expanded section header in a band between
        // lines, which meet the sidebar frame with joints.
        await editor.sendKey("Ctrl+Alt+d");
        await editor.waitForText(seen((rows) => rows.some((row) => row.includes("RUN AND DEBUG"))));
        const joints = screen.filter((row) => row.startsWith("├")).length;
        if (joints < 3) throw new Error(`expected header bands with joints, got ${String(joints)}:\n${screen.join("\n")}`);
        await editor.capture("debug-view");

        // The sidebar sash lies over both frame lines: grab the editor's line and drag it 6 columns right.
        const sidebar = await editor.waitForNode("#workbench-view-debug");
        const editorLine = sidebar.box.x + sidebar.box.width + 1;
        const midY = sidebar.box.y + Math.floor(sidebar.box.height / 2);
        await editor.sendMouse({ action: "press", button: "left", x: editorLine, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: editorLine + 6, y: midY });
        await editor.sendMouse({ action: "release", button: "left", x: editorLine + 6, y: midY });
        const expected = sidebar.box.width + 6;
        await editor.waitForText(seen((rows) => rows[midY].indexOf("││") === sidebar.box.x + expected));
        const resized = await editor.waitForNode("#workbench-view-debug");
        if (resized.box.width !== expected) {
            throw new Error(`sidebar width ${String(resized.box.width)}, expected ${String(expected)}`);
        }
        await editor.capture("sidebar-resized");
    },
});
