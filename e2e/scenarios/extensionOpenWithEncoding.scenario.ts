import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-open-encoding");

export default defineScenario({
    name: "extension-open-with-encoding",
    title: "openTextDocument(file, { encoding: 'cp1252' }): the live model decodes in it, the status bar shows cp1252",
    seedUserData: userData,
    cols: 110,
    rows: 22,
    async run(editor) {
        await editor.waitForReady();
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Open Encoding Demo: Open");
        await editor.waitForText((t) => t.includes("Open Encoding Demo: Open"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("latin.txt") && t.includes("Hellö Wörld") && t.includes("cp1252"), {
            timeoutMs: 20_000,
        });
        await editor.capture("cp1252-document");
    },
});
