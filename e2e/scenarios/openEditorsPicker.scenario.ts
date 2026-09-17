import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Пикер открытых редакторов (VS Code `workbench.action.showAllEditors`, префикс
// `edt `, бинд Ctrl+K Ctrl+P): список открытых вкладок в MRU-порядке — имя файла
// плюс путь относительно корня, точка у несохранённой вкладки, — fuzzy-фильтр по
// вводу и прыжок на выбранную вкладку по Enter. Открыты два тёзки main.ts из
// разных каталогов: именно на них видно, зачем строке колонка пути.

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
        // Четыре вкладки открыты, активна последняя (folding.ts).
        await editor.waitForText((t) => t.includes("folding.ts") && t.includes("sample.ts"));

        // Правка активной вкладки: у неё в пикере появится маркер «●».
        await editor.sendText("// ");
        await editor.waitForText((t) => t.includes("●"));
        await editor.capture("tabs");

        // Ctrl+K Ctrl+P — открытые редакторы в MRU-порядке: активная сверху,
        // у каждой строки путь относительно корня воркспейса.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        // Плейсхолдер не ждём: строка ввода префиллена префиксом «edt », а
        // плейсхолдер виден только у пустого ввода — ждём сам список.
        await editor.waitForText((t) => t.includes("e2e/fixtures/lspSample"));
        await editor.capture("picker");

        // Fuzzy-фильтр: остаются два тёзки main.ts, различимые колонкой пути.
        await editor.sendText("main");
        await editor.waitForText((t) => t.includes("formatSample") && t.includes("lspSample"));
        await editor.capture("filtered");

        // Enter — переход на выбранную вкладку (первая строка отфильтрованного
        // списка: та из тёзок, где пользователь был недавнее).
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("const  answer"));
        await editor.capture("switched");
    },
});
