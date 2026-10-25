import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// `contributes.viewsWelcome`: an extension view with nothing to show draws the manifest's text and buttons.
// `views-welcome` registers an empty Bookmarks tree; the text carries an underlined link, the "Add Bookmark"
// button runs a command with a JSON argument, and the tree's first row replaces the welcome.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-views-welcome");

async function clickText(editor: ScenarioDriver, needle: string): Promise<void> {
    const frame = await editor.waitForText((t) => t.includes(needle));
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen`);
    await editor.click(cell.x, cell.y);
}

export default defineScenario({
    name: "views-welcome",
    title: "viewsWelcome: an empty extension view shows text, a link and a button; the button fills the tree",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Extension host scenario: the CI safety net runs on Linux only (like extension-tree-view).
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // A foreign section in Explorer starts collapsed, as upstream.
        await clickText(editor, "BOOKMARKS");
        await editor.waitForText((t) => t.includes("You have no bookmarks yet.") && t.includes("[ Add Bookmark ]"), {
            timeoutMs: 15000,
        });
        await editor.capture("welcome");

        await clickText(editor, "Add Bookmark");
        await editor.waitForText((t) => t.includes("Bookmark: main.ts") && !t.includes("You have no bookmarks yet."), {
            timeoutMs: 10000,
        });
        await editor.capture("tree");
    },
});
