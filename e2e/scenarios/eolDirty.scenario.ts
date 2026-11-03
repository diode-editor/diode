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

async function convertTo(editor: ScenarioDriver, eol: "LF" | "CRLF"): Promise<void> {
    const title = `End of Line: Convert to ${eol} `;
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
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

        await convertTo(editor, "CRLF");
        await expectTabDirty(editor, true);

        await convertTo(editor, "LF");
        await expectTabDirty(editor, true);
        await editor.capture("eol-there-and-back");

        await editor.sendKey("Ctrl+Z");
        await expectTabDirty(editor, true);
        await editor.sendKey("Ctrl+Z");
        await expectTabDirty(editor, false);
        await editor.capture("undo-to-saved");
    },
});
