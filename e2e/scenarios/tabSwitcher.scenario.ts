import { resolve } from "node:path";

import { findNode } from "../helpers/inspectorClient.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The headless inspector does not send keyup for a lone modifier (kitty event type 3) — the end of a series is
// signalled with Ctrl+PgDn: it ends the series the same way releasing Ctrl does.

const fileA = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const fileB = resolve(repoRoot, "e2e", "fixtures", "folding.ts");
const fileC = resolve(repoRoot, "e2e", "fixtures", "wordWrap.ts");

export default defineScenario({
    name: "tab-switcher",
    title: "Ctrl+Tab: visible MRU tab list stepped with arrows; Ctrl+PgDn/PgUp: cycle tabs in order",
    open: [repoRoot, fileA, fileB, fileC],
    cols: 120,
    rows: 32,
    async run(editor) {
        // Wait for each series step by the content under the overlay (the names are always in the frame). The overlay
        // (~10% of the screen height) covers the editor's first lines, so the markers are text beside or below it:
        // the tail of folding.ts's first line and sample.ts's fifth line. Every part is framed with "╭", so whether
        // the overlay is open is read from the element tree, not from the frame.
        const underOverlay = { "folding.ts": "several foldable regions", "sample.ts": "String(answer)" } as const;
        const switcherOpen = async (): Promise<boolean> =>
            findNode((await editor.getDocument()).root, (node) => node.type === "TabSwitcherElement") !== null;
        const stepTo = async (file: keyof typeof underOverlay): Promise<void> => {
            await editor.waitForText((t) => t.includes(underOverlay[file]));
            if (!(await switcherOpen())) throw new Error(`the tab switcher is not open at the ${file} step`);
        };

        await editor.waitForText(
            (t) => t.includes("sample.ts") && t.includes("folding.ts") && t.includes("wordWrap.ts"),
        );

        // An edit in the active tab (wordWrap.ts): the overlay shows a ● marker for it.
        await editor.sendText("// touched\n");
        await editor.waitForText((t) => t.includes("●"));

        await editor.sendKey("Ctrl+Tab");
        await stepTo("folding.ts");
        await editor.capture("mru-list");

        await editor.sendKey("Ctrl+Tab");
        await stepTo("sample.ts");
        await editor.capture("mru-deeper");

        await editor.sendKey("Ctrl+ArrowUp");
        await stepTo("folding.ts");
        await editor.capture("arrow-up");

        await editor.sendKey("Ctrl+ArrowDown");
        await stepTo("sample.ts");
        await editor.capture("arrow-down");

        // Ctrl+PgDn follows tab order, not MRU.
        await editor.sendKey("Ctrl+PageDown");
        await waitUntil(switcherOpen, (open) => !open, { describe: "the tab switcher closes" });
        await editor.capture("visual-cycle");
    },
});
