import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// The navigation of the stock basedpyright on one file, in the panels the user sees: implementations of a base method
// (the server lists the base too), every overload from F12 on a declaration, reads and writes of a variable, the
// outline, the callers of a function and the `f` that `{` puts before a string.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "pySample");
const shapesFile = resolve(sampleDir, "shapes.py");

async function goTo(editor: ScenarioDriver, position: string): Promise<void> {
    await editor.sendKey("Ctrl+G");
    await editor.waitForNode("#quickInput");
    await editor.sendText(position);
    await editor.sendKey("Enter");
    await editor.waitForText((t) => t.includes(`Ln ${position.replace(":", ", Col ")}`));
}

/** Whether `total` on the frame is painted as a write where it is assigned and as a read where it is used. */
function readsDifferFromWrites(frame: GridSnapshot): boolean {
    const background = (prefix: string, offset: number): unknown => {
        const start = findTextCell(frame, prefix);
        return start === null ? undefined : frame.cells[start.y * frame.cols + start.x + offset]?.bg;
    };
    const plain = background("return total", 0);
    const read = background("return total", "return ".length);
    const write = background("total: float = total +", 0);
    return read !== plain && write !== plain && write !== read;
}

export default defineScenario({
    name: "python-navigation",
    // Ctrl+Shift and Shift+Alt shortcuts need an extended tier, which only an explicit setting turns on (#1049).
    settings: { "terminal.tier": "csi-u" },
    title: "Stock basedpyright: implementations, overloads, occurrences, symbols, callers, f-string on type",
    open: [sampleDir, shapesFile],
    installVsix: ["detachhead.basedpyright"],
    network: true,
    cols: 110,
    rows: 40,
    // Extension host scenarios run a subprocess + a forked server — Linux only.
    skipOn: ["win32", "darwin"],
    // Ctrl+Shift+O has no name in the key DSL. Only a command takes the focus back from the References panel.
    // F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [
        { key: "alt+k", command: "workbench.action.focusActiveEditorGroup" },
        { key: "alt+l", command: "workbench.action.gotoSymbol" },
    ],
    async run(editor) {
        await editor.waitForReady();
        // The hints appear once the server has analysed the file.
        await editor.waitForText((t) => t.includes("def measure(figure: Shape) -> float:"), { timeoutMs: 180_000 });

        await goTo(editor, "5:9");
        await editor.sendKey("Ctrl+F12");
        await editor.waitForText((t) => t.includes("Implementations") && t.includes("3 results in 1 file"), {
            timeoutMs: 60_000,
        });
        await editor.capture("implementations of a base method");

        await goTo(editor, "20:5");
        await editor.sendKey("F12");
        await editor.waitForText((t) => t.includes("Definitions") && t.includes("3 results in 1 file"), {
            timeoutMs: 60_000,
        });
        await editor.capture("every overload from F12");

        await goTo(editor, "28:5");
        await waitUntil(() => editor.captureFrame(), readsDifferFromWrites, {
            describe: "reads and writes of total in their own colors",
            timeoutMs: 60_000,
            intervalMs: 200,
        });
        await editor.capture("reads and writes of total");

        await editor.sendKey("Alt+l");
        // The picker scrolls to the symbol at the caret, so the `symbols (12)` row may be above the visible part.
        await editor.waitForText((t) => t.includes("Square") && t.includes("figure"), { timeoutMs: 60_000 });
        await editor.capture("the outline in Go to Symbol");
        await editor.sendKey("Escape");

        await goTo(editor, "27:5");
        await editor.sendKey("Shift+Alt+h");
        await editor.waitForText((t) => t.includes("Callers Of") && t.includes("(module) shapes.py"), {
            timeoutMs: 60_000,
        });
        await editor.capture("callers of measure");

        await editor.sendKey("Alt+k");
        await editor.sendKey("Ctrl+End");
        for (const char of 'print("{') await editor.sendKey(char);
        await editor.waitForText((t) => t.includes('print(f"{'), { timeoutMs: 60_000 });
        await editor.capture("the f before the string");
    },
});
