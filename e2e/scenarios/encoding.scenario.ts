import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const cp1251File = resolve(repoRoot, "e2e", "fixtures", "cp1251.txt");

export default defineScenario({
    name: "encoding",
    title: "Reopen a Windows-1251 file with the right encoding",
    open: [repoRoot, cp1251File],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("UTF-8"));
        await editor.capture("mojibake-utf8");

        // Ctrl+Shift+P не проходит через legacy-терминал — F1. Ждём саму палитру: иначе при неактивном бинде запрос
        // уйдёт в буфер редактора и совпадёт со следующим waitForText.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Change File Encoding");
        await editor.waitForText((t) => t.includes("Change File Encoding"));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("Reopen with Encoding"));
        await editor.capture("picker-mode");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("Select File Encoding"));
        await editor.sendText("Windows 1251");
        await editor.waitForText((t) => t.includes("Cyrillic (Windows 1251)"));
        await editor.capture("picker-encoding");
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes("Привет, мир!") && t.includes("Windows 1251"));
        await editor.capture("decoded-cp1251");
    },
});
