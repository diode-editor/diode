import { resolve } from "node:path";

import type { NodeSnapshot } from "@tuidom/inspector/protocol";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// As upstream (`workbench.list.openMode: singleClick`): a click opens a preview and keeps focus in the
// tree, a double click opens the file pinned (docs/TODO/PreviewEditors.md).
// Labels come from the strip's `inspectState`: in the frame an icon PUA glyph sits next to the label
// and breaks text matching.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "previewTabs");

interface TabState {
    label: string;
    active: boolean;
    modified: boolean;
}

function tabsOf(strip: NodeSnapshot): TabState[] {
    return (strip.state?.tabs ?? []) as TabState[];
}

async function waitForTabs(editor: ScenarioDriver, expected: readonly string[]): Promise<TabState[]> {
    let seen: string[] = [];
    for (let attempt = 0; attempt < 60; attempt++) {
        const tabs = tabsOf(await editor.waitForNode("EditorTabStripElement"));
        seen = tabs.map((tab) => tab.label);
        if (seen.length === expected.length && expected.every((label, i) => seen[i].includes(label))) {
            return tabs;
        }
        await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(`expected tabs [${expected.join(", ")}] in the strip, got [${seen.join(", ")}]`);
}

export default defineScenario({
    name: "preview-tabs",
    title: "Preview mode: a click previews, a double click pins",
    open: [sampleDir],
    cols: 110,
    rows: 24,
    async run(editor) {
        // The workspace opens with no files: three files in the tree, no tab strip yet.
        const tree = await editor.waitForNode("TreeViewElement");
        await editor.waitForText((t) => t.includes("alpha.ts") && t.includes("beta.ts") && t.includes("gamma.ts"));
        if (tabsOf(await editor.waitForNode("EditorTabStripElement")).length !== 0) {
            throw new Error("expected an empty tab strip");
        }
        await editor.capture("tree-only");

        // Tree rows go top to bottom alphabetically; the first row
        // sits exactly on the widget's top edge.
        const rowX = tree.box.x + 5;
        const rowY = (index: number): number => tree.box.y + index;
        const click = (index: number): Promise<void> => editor.click(rowX, rowY(index));
        /** Four events in a row without settling — within the double-click window. */
        const doubleClick = async (index: number): Promise<void> => {
            for (let i = 0; i < 2; i++) {
                await editor.sendMouse({ action: "press", button: "left", x: rowX, y: rowY(index) });
                await editor.sendMouse({ action: "release", button: "left", x: rowX, y: rowY(index) });
            }
        };

        // A click opens alpha.ts as a preview.
        await click(0);
        await waitForTabs(editor, ["alpha.ts"]);
        await editor.capture("click-previews");

        // The next click: beta.ts TAKES alpha.ts's SLOT, still a single tab.
        await click(1);
        const afterSecond = await waitForTabs(editor, ["beta.ts"]);
        if (!afterSecond[0].active) throw new Error("the new preview did not become the active tab");
        await editor.capture("preview-replaced");

        // Focus stayed in the tree: the arrow moves the cursor to gamma.ts and opens nothing.
        await editor.sendKey("ArrowDown");
        await waitForTabs(editor, ["beta.ts"]);

        // A double click opens gamma.ts pinned: its first click takes the preview slot,
        // the double click pins it there, so the next click opens alpha.ts beside it.
        await doubleClick(2);
        await waitForTabs(editor, ["gamma.ts"]);
        await click(0);
        await waitForTabs(editor, ["gamma.ts", "alpha.ts"]);
        await editor.capture("double-click-pins");

        // Ctrl+K Enter (`workbench.action.keepEditor`) pins the preview, so the
        // next click opens a new preview as a third tab.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Enter");
        await click(1);
        await waitForTabs(editor, ["gamma.ts", "alpha.ts", "beta.ts"]);
        await editor.capture("keep-editor-pins-tab");
    },
});
