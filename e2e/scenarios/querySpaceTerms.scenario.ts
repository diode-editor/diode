import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// #374: a space in a picker query separates terms; the command palette matches fuzzily. The queries are the ones the
// bug was diagnosed on.

const workspace = resolve(repoRoot, "e2e", "fixtures", "querySpaceTerms");
const notes = resolve(workspace, "notes.txt");

/** Filtering shows in the count of list rows: the tree on the left always shows the `lib`/`src` directories. */
function countOf(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

export default defineScenario({
    name: "query-space-terms",
    title: "Query with a space in Ctrl+P and the command palette",
    open: [workspace, notes],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText((t) => t.includes("Demo workspace"));

        await editor.sendKey("Ctrl+P");
        // Otherwise the text is lost: the picker has not taken focus yet.
        await editor.waitForNode("#quickInput");

        await editor.sendText("other");
        await editor.waitForText((t) => countOf(t, "other.ts") === 2);
        await editor.capture("files-one-term");

        await editor.sendText(" src");
        await editor.waitForText((t) => countOf(t, "other.ts") === 1);
        await editor.capture("files-two-terms");

        await editor.sendKey("Escape");

        // F1, not Ctrl+Shift+P: the latter does not get through the e2e key DSL.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");

        await editor.sendText("go line");
        await editor.waitForText((t) => t.includes("Go to Line/Column"));
        await editor.capture("palette-two-terms");
    },
});
