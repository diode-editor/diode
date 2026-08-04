import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Encoding support demo: a windows-1251 file first renders as mojibake (read
// as utf-8, "UTF-8" in the status bar), then "Change File Encoding" → "Reopen
// with Encoding" → Cyrillic (Windows 1251) decodes it and the status bar
// segment flips to "Windows 1251".

const cp1251File = resolve(repoRoot, "e2e", "fixtures", "cp1251.txt");

export default defineScenario({
    name: "encoding",
    title: "Reopen a Windows-1251 file with the right encoding",
    open: [repoRoot, cp1251File],
    cols: 120,
    rows: 32,
    async run(editor) {
        // Read as utf-8 the cp1251 bytes are mojibake; the status bar shows UTF-8.
        await editor.waitForText((t) => t.includes("UTF-8"));
        await editor.capture("mojibake-utf8");

        // Command palette → Change File Encoding. Ctrl+Shift+P не проходит через
        // legacy-терминал headless-сессии — используем chord-фоллбэк Ctrl+K Ctrl+P
        // (активен ровно в legacy — герметичный baseline харнесса). Прежде чем
        // печатать запрос, дожидаемся самой палитры: иначе при неактивном chord'е
        // текст уйдёт в буфер редактора и следующий waitForText совпадёт с ним.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Change File Encoding");
        await editor.waitForText((t) => t.includes("Change File Encoding"));
        await editor.sendKey("Enter");

        // Level 1: Reopen with Encoding / Save with Encoding.
        await editor.waitForText((t) => t.includes("Reopen with Encoding"));
        await editor.capture("picker-mode");
        await editor.sendKey("Enter");

        // Level 2: encoding list, filter to Windows 1251.
        await editor.waitForText((t) => t.includes("Select File Encoding"));
        await editor.sendText("Windows 1251");
        await editor.waitForText((t) => t.includes("Cyrillic (Windows 1251)"));
        await editor.capture("picker-encoding");
        await editor.sendKey("Enter");

        // Decoded Cyrillic text + "Windows 1251" in the status bar.
        await editor.waitForText((t) => t.includes("Привет, мир!") && t.includes("Windows 1251"));
        await editor.capture("decoded-cp1251");
    },
});
