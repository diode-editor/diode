import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Tab добирает каретку ДО следующего табстопа, а не вставляет `tabSize` пробелов; у мультикурсора каждая
// каретка получает свою добавку.

const demoFile = resolve(repoRoot, "e2e", "fixtures", "tabStopsDemo.txt");

export default defineScenario({
    name: "tab-stops",
    title: "Tab выравнивает каретку по табстопам",
    open: [repoRoot, demoFile],
    cols: 100,
    rows: 24,
    // Детекции отступа в фикстуре не за что зацепиться — пинним отступ явно.
    settings: { "editor.insertSpaces": true, "editor.tabSize": 4, "editor.detectIndentation": false },
    async run(editor) {
        await editor.waitForText((t) => t.includes("abcd=2"));
        await editor.capture("file");

        await editor.sendKey("End");
        await editor.waitForText((t) => t.includes("Ln 1, Col 3"));

        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Ln 1, Col 5"));
        await editor.capture("aligned-to-tab-stop");

        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Ln 1, Col 9"));
        await editor.capture("full-level-from-tab-stop");

        // По каретке после каждого имени — колонки 3, 5 и 2.
        await editor.sendKey("Ctrl+Z");
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => !t.includes("Ln 1, Col 5"));
        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.waitForText((t) => t.includes("(3 selections)"));
        await editor.sendKey("Ctrl+ArrowRight");
        await editor.capture("three-carets");

        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("ab  =1") && t.includes("abcd    =2") && t.includes("x   =3"));
        await editor.capture("each-caret-to-its-tab-stop");
    },
});
