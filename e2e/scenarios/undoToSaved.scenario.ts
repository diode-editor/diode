import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// #1010: the tab is dirty exactly when the text differs from the saved one — undo back to it clears the ●, redo
// brings it back, as upstream (alternative version id).

// A copy: the scenario saves the file.
const sampleDir = mkdtempSync(join(tmpdir(), "diode-undo-to-saved-"));
const file = join(sampleDir, "n.txt");
writeFileSync(file, "alpha\n");

/** Looks at the frame: the tab strip row shows ● for a modified tab, × for a clean one. */
async function expectTabDirty(editor: ScenarioDriver, dirty: boolean): Promise<void> {
    const strip = await editor.waitForState("EditorTabStripElement", (state) => {
        const tabs = (state?.tabs ?? []) as { modified: boolean }[];
        return tabs.length === 1 && tabs[0].modified === dirty;
    });
    const row = frameLine(await editor.captureFrame(), strip.box.y);
    if (row.includes("●") !== dirty) throw new Error(`tab row "${row}": expected ${dirty ? "●" : "no ●"}`);
}

export default defineScenario({
    name: "undo-to-saved",
    title: "Undo back to the saved text clears the dirty mark, redo brings it back",
    open: [sampleDir, file],
    cols: 80,
    rows: 12,
    async run(editor) {
        await editor.waitForText((t) => t.includes("alpha"));
        await expectTabDirty(editor, false);

        await editor.sendText("z");
        await expectTabDirty(editor, true);
        await editor.sendKey("Ctrl+S");
        await expectTabDirty(editor, false);

        await editor.sendText("w");
        await expectTabDirty(editor, true);
        await editor.capture("typed-after-save");

        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("zalpha"));
        await expectTabDirty(editor, false);
        await editor.capture("undo-to-saved");

        await editor.sendKey("Ctrl+Y");
        await editor.waitForText((t) => t.includes("zwalpha"));
        await expectTabDirty(editor, true);

        // Past the save: the text on disk is `zalpha`, so `alpha` is modified.
        await editor.sendKey("Ctrl+Z");
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => !t.includes("zalpha") && t.includes("alpha"));
        await expectTabDirty(editor, true);
    },
});
