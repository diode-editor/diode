import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Tab по табстопам (паритет с VS Code): при отступе пробелами Tab добирает
// каретку ДО следующего табстопа, а не вставляет всегда `tabSize` пробелов.
// Два свидетеля на кадре: счётчик `Ln/Col` в статус-баре (каретка с колонки 3
// уезжает на 5, а не на 7, как было) и сам текст — у мультикурсора каждая
// каретка получает СВОЮ добавку, поэтому строки разной длины одним нажатием
// встают по табстопам, а не съезжают каждая на четыре колонки.

const demoFile = resolve(repoRoot, "e2e", "fixtures", "tabStopsDemo.txt");

export default defineScenario({
    name: "tab-stops",
    title: "Tab выравнивает каретку по табстопам",
    open: [repoRoot, demoFile],
    cols: 100,
    rows: 24,
    // Фикстура — четыре короткие строки без отступов, детекции не за что
    // зацепиться; пинним отступ явно, чтобы демо не зависело от её исхода.
    settings: { "editor.insertSpaces": true, "editor.tabSize": 4, "editor.detectIndentation": false },
    async run(editor) {
        await editor.waitForText((t) => t.includes("abcd=2"));
        await editor.capture("file");

        // Каретка в конец первой строки: колонка 3, до табстопа — две колонки.
        await editor.sendKey("End");
        await editor.waitForText((t) => t.includes("Ln 1, Col 3"));

        // Один Tab — и каретка ровно на табстопе, колонка 5, а не 7.
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Ln 1, Col 5"));
        await editor.capture("aligned-to-tab-stop");

        // Второй Tab идёт уже С табстопа — вставляется полный уровень, до 9.
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("Ln 1, Col 9"));
        await editor.capture("full-level-from-tab-stop");

        // Мультикурсор: по каретке на каждую строку `имя=значение`, сразу после
        // имени — то есть на колонках 3, 5 и 2 (имена разной длины).
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

        // Один Tab — и каждая каретка добрала до СВОЕГО табстопа: 2, 4 и 3
        // пробела соответственно. Если бы Tab вставлял `tabSize` пробелов,
        // все три `=` съехали бы на четыре колонки и остались вразнобой.
        await editor.sendKey("Tab");
        await editor.waitForText((t) => t.includes("ab  =1") && t.includes("abcd    =2") && t.includes("x   =3"));
        await editor.capture("each-caret-to-its-tab-stop");
    },
});
