import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-untitled-uri");

export default defineScenario({
    name: "extension-untitled-uri",
    title: "openTextDocument(untitled:new.txt): a named untitled document, Ctrl+S asks where and the tab becomes the file",
    seedUserData: userData,
    cols: 110,
    rows: 22,
    async run(editor) {
        await editor.waitForReady();
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Untitled Uri Demo: Open");
        await editor.waitForText((t) => t.includes("Untitled Uri Demo: Open"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("new.txt") && t.includes("text from the extension"), {
            timeoutMs: 20_000,
        });
        await editor.capture("dirty-tab");

        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => t.includes("Save As") && t.includes("new.txt"));
        await editor.capture("save-as");

        await editor.sendKey("Enter");
        // The tab is the file now: the dialog is gone and the text is still there.
        await editor.waitForText((t) => !t.includes("Save As") && t.includes("text from the extension"));
        await editor.capture("saved-file");
    },
});
