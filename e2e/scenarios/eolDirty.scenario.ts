import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// #1029: an EOL change is an edit like any other, as upstream `setEOL`: it makes the tab dirty, changing it back by
// hand is one more edit and keeps the ●, and only undo back to the saved state clears it.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-eol-dirty-"));
const file = join(sampleDir, "n.txt");
writeFileSync(file, "alpha\nbeta\n");

/** Looks at the frame: the tab strip row shows ● for a modified tab, × for a clean one. */
async function expectTabDirty(editor: ScenarioDriver, dirty: boolean): Promise<void> {
    const strip = await editor.waitForState("EditorTabStripElement", (state) => {
        const tabs = (state?.tabs ?? []) as { modified: boolean }[];
        return tabs.length === 1 && tabs[0].modified === dirty;
    });
    const row = frameLine(await editor.captureFrame(), strip.box.y);
    if (row.includes("●") !== dirty) throw new Error(`tab row "${row}": expected ${dirty ? "●" : "no ●"}`);
}

/** "End of Line: Toggle LF / CRLF" from the palette; the status bar then shows `eol`. */
async function toggleTo(editor: ScenarioDriver, eol: "LF" | "CRLF"): Promise<void> {
    const title = "End of Line: Toggle LF / CRLF";
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    // The title twice: the input and the list row. Enter before the list is filtered runs another command.
    await editor.waitForText((t) => t.split(title).length > 2);
    await editor.sendKey("Enter");
    // The status bar segment: `  LF  ` is not a part of `  CRLF  `.
    await editor.waitForText((t) => t.includes(`  ${eol}  `));
}

export default defineScenario({
    name: "eol-dirty",
    title: "An EOL change is an edit: there and back stays dirty, undo clears the dirty mark",
    open: [sampleDir, file],
    cols: 80,
    rows: 12,
    async run(editor) {
        await editor.waitForText((t) => t.includes("alpha"));
        await expectTabDirty(editor, false);

        await toggleTo(editor, "CRLF");
        await expectTabDirty(editor, true);

        await toggleTo(editor, "LF");
        await expectTabDirty(editor, true);
        await editor.capture("eol-there-and-back");

        await editor.sendKey("Ctrl+Z");
        await expectTabDirty(editor, true);
        await editor.sendKey("Ctrl+Z");
        await expectTabDirty(editor, false);
        await editor.capture("undo-to-saved");
    },
});
