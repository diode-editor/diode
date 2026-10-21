import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-untitled-report");

export default defineScenario({
    name: "extension-untitled-document",
    title: "openTextDocument({ content, language }): an extension report in an untitled document",
    seedUserData: userData,
    cols: 110,
    rows: 22,
    async run(editor) {
        // The command is registered in the fixture's activate(): wait for the extension host.
        await editor.waitForReady();
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Untitled Report Demo: Locate");
        await editor.waitForText((t) => t.includes("Untitled Report Demo: Locate Configured Tools"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Untitled-1") && t.includes("# Tools Configuration"), {
            timeoutMs: 20_000,
        });
        await editor.waitForText((t) => t.includes("Markdown"));
        await editor.capture("report");

        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => t.includes("Save As") && t.includes("Untitled-1.md"));
        await editor.capture("save-as");
    },
});
