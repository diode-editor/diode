import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Upstream `.codelens-decoration > a:hover`: the command under the pointer takes `editorLink.activeForeground`, the
// other one and the ` | ` between them keep the lens color. The hand pointer (OSC 22) is not in the frame;
// editorElement.codeLensHover.test.ts checks it. `demo-code-lens` gives `2 references | Run` over each function.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-code-lens-hover-"));
const tsFile = join(sampleDir, "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-code-lens");

const ROW = "2 references | Run";

function fgAt(frame: GridSnapshot, x: number, y: number): number {
    return frame.cells[y * frame.cols + x].fg;
}

export default defineScenario({
    name: "code-lens-hover",
    title: "Code lens: the command under the mouse lights up, the separator does not",
    seedUserData: userData,
    open: [sampleDir, tsFile],
    cols: 90,
    rows: 20,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async prepare() {
        writeFileSync(tsFile, "function alpha() {}\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes(ROW), { timeoutMs: 20_000 });
        const start = findTextCell(await editor.captureFrame(), ROW);
        if (start === null) throw new Error(`"${ROW}" is not on screen`);
        const { x, y } = start;
        const refsX = x + 2;
        const runX = x + ROW.indexOf("Run");
        const barX = x + ROW.indexOf("|");

        const lights = async (litX: number, darkX: number, what: string): Promise<void> => {
            const frame = await editor.captureFrame();
            if (fgAt(frame, litX, y) === fgAt(frame, darkX, y)) throw new Error(`${what}: not lit`);
            if (fgAt(frame, darkX, y) !== fgAt(frame, barX, y)) throw new Error(`${what}: the other command is lit`);
        };

        await editor.sendMouse({ action: "move", button: "none", x: refsX, y });
        await lights(refsX, runX, "2 references");
        await editor.capture("hover over 2 references");

        await editor.sendMouse({ action: "move", button: "none", x: runX + 1, y });
        await lights(runX, refsX, "Run");
        await editor.capture("hover over Run");

        await editor.sendMouse({ action: "move", button: "none", x: barX, y });
        const frame = await editor.captureFrame();
        if (fgAt(frame, refsX, y) !== fgAt(frame, runX, y)) throw new Error("the separator lights a command");
        await editor.capture("the separator is not a command");
    },
});
