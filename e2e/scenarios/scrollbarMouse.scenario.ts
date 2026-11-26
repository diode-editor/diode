import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

const COLS = 100;
const ROWS = 30;

/** A file far taller than the editor: the vertical bar has room to travel. */
function makeWorkspace(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-scrollbar-mouse-demo-"));
    const lines = Array.from({ length: 200 }, (_, i) => `row ${String(i)} of the file`);
    // The cursor starts on a line without words: no occurrence marks cover the bar.
    lines[0] = "# --";
    writeFileSync(join(dir, "long.txt"), `${lines.join("\n")}\n`);
    return dir;
}

const dir = makeWorkspace();

export default defineScenario({
    name: "scrollbar-mouse",
    title: "Scrollbars follow the mouse: a press on the track jumps there, the thumb drags",
    open: [dir, join(dir, "long.txt")],
    cols: COLS,
    rows: ROWS,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("row 5 of the file"));
        await editor.capture("start");

        // The editor's vertical bar runs just inside the right frame line.
        const barX = COLS - 2;
        await editor.sendMouse({ action: "press", button: "left", x: barX, y: ROWS - 4 });
        await editor.sendMouse({ action: "release", button: "left", x: barX, y: ROWS - 4 });
        await editor.waitForText((t) => t.includes("row 190 of the file") && !t.includes("row 5 of the file"));
        await editor.capture("track-press");

        // Grab the thumb near the bottom and drag it up to the middle of the track.
        await editor.sendMouse({ action: "press", button: "left", x: barX, y: ROWS - 4 });
        await editor.sendMouse({ action: "move", button: "left", x: barX - 30, y: 15 });
        await editor.sendMouse({ action: "release", button: "left", x: barX - 30, y: 15 });
        await editor.waitForText((t) => t.includes("row 90 of the file") && !t.includes("row 190 of the file"));
        await editor.capture("thumb-drag");
    },
});
