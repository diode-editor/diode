import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Два тёзки main.ts из разных каталогов — на них видно, зачем строке пикера колонка пути.

const fixtures = resolve(repoRoot, "e2e", "fixtures");
const sampleFile = resolve(fixtures, "sample.ts");
const lspMain = resolve(fixtures, "lspSample", "main.ts");
const formatMain = resolve(fixtures, "formatSample", "main.ts");
const foldingFile = resolve(fixtures, "folding.ts");

export default defineScenario({
    name: "open-editors-picker",
    title: "Пикер открытых редакторов (Ctrl+K Ctrl+P)",
    open: [repoRoot, sampleFile, lspMain, formatMain, foldingFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("folding.ts") && t.includes("sample.ts"));

        // Правка активной вкладки: у неё в пикере появится маркер «●».
        await editor.sendText("// ");
        await editor.waitForText((t) => t.includes("●"));
        await editor.capture("tabs");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        // Не плейсхолдер: ввод префиллен «edt », а плейсхолдер виден только у пустого ввода.
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
