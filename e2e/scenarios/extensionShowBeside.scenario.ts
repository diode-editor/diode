import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-show-beside");
const workspace = resolve(repoRoot, "e2e", "fixtures", "show-beside-workspace");

export default defineScenario({
    name: "extension-show-beside",
    title: "showTextDocument(doc, ViewColumn.Beside): two groups, the shown editor is the active one",
    seedUserData: userData,
    open: [workspace],
    cols: 110,
    rows: 22,
    async run(editor) {
        await editor.waitForReady();
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Show Beside Demo: Open");
        await editor.waitForText((t) => t.includes("Show Beside Demo: Open"));
        await editor.sendKey("Enter");
        await editor.waitForText(
            (t) =>
                t.includes("LEFT-CONTENT") &&
                t.includes("RIGHT-CONTENT") &&
                t.includes("active editor: same, column 2"),
            { timeoutMs: 20_000 },
        );
        await editor.capture("beside");
    },
});
