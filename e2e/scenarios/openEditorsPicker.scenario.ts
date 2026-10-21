import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Two main.ts namesakes from different directories show why a picker row needs the path column.

const fixtures = resolve(repoRoot, "e2e", "fixtures");
const sampleFile = resolve(fixtures, "sample.ts");
const lspMain = resolve(fixtures, "lspSample", "main.ts");
const formatMain = resolve(fixtures, "formatSample", "main.ts");
const foldingFile = resolve(fixtures, "folding.ts");

export default defineScenario({
    name: "open-editors-picker",
    title: "Open editors picker (Ctrl+K Ctrl+P)",
    open: [repoRoot, sampleFile, lspMain, formatMain, foldingFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("folding.ts") && t.includes("sample.ts"));

        // Edit the active tab so it gets the "●" marker in the picker.
        await editor.sendText("// ");
        await editor.waitForText((t) => t.includes("●"));
        await editor.capture("tabs");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        // Not the placeholder: the input is prefilled with "edt ",
        // and the placeholder shows only when the input is empty.
        await editor.waitForText((t) => t.includes("e2e/fixtures/lspSample"));
        await editor.capture("picker");

        await editor.sendText("main");
        await editor.waitForText((t) => t.includes("formatSample") && t.includes("lspSample"));
        await editor.capture("filtered");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("const  answer"));
        await editor.capture("switched");
    },
});
