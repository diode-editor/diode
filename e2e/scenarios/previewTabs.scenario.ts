import { resolve } from "node:path";

import type { NodeSnapshot } from "@tuidom/inspector/protocol";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Activation is click + Enter: a single `TreeViewElement` click only selects the row; "click opens preview"
// comes once the engine tells click counts apart (phase 3, docs/TODO/PreviewEditors.md).
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
    title: "Preview mode: walking the tree reuses a single tab",
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
        /** Click selects the row, Enter opens it. */
        const activate = async (index: number): Promise<void> => {
            await editor.click(rowX, rowY(index));
            await editor.sendKey("Enter");
        };

        // Activation 1: alpha.ts opens as a preview.
        await activate(0);
        await waitForTabs(editor, ["alpha.ts"]);
        await editor.capture("first-preview");

        // Activation 2: beta.ts TAKES alpha.ts's SLOT, still a single tab.
        await activate(1);
        const afterSecond = await waitForTabs(editor, ["beta.ts"]);
        if (!afterSecond[0].active) throw new Error("the new preview did not become the active tab");
        await editor.capture("preview-replaced");

        // An edit pins the tab: after activation focus is already in the editor.
        await editor.sendText("// pinned by an edit\n");
        const pinnedByEdit = await waitForTabs(editor, ["beta.ts"]);
        if (!pinnedByEdit[0].modified) throw new Error("the edit did not reach the tab");

        // Activation 3: gamma.ts opens ALONGSIDE; replacement doesn't touch
        // the tab pinned by the edit.
        await activate(2);
        await waitForTabs(editor, ["beta.ts", "gamma.ts"]);
        await editor.capture("edit-pins-tab");

        // Activation 4: alpha.ts replaces gamma.ts (a single preview again), and
        // beta.ts stays: a group has exactly one preview tab.
        await activate(0);
        await waitForTabs(editor, ["beta.ts", "alpha.ts"]);

        // Ctrl+K Enter (`workbench.action.keepEditor`) pins the preview without
        // an edit, so the next activation opens a new preview as a third tab.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Enter");
        await activate(2);
        await waitForTabs(editor, ["beta.ts", "alpha.ts", "gamma.ts"]);
        await editor.capture("keep-editor-pins-tab");
    },
});
