import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Go Back / Go Forward: история помнит МЕСТО, а не вкладку. Кадры показывают
// точку, откуда ушли (Ln в статус-баре), прыжок в другой файл и возврат ровно
// туда же — плюс сами пункты в меню Go, которые появляются только когда есть
// куда идти (`canNavigateBack` / `canNavigateForward`).
//
// Команды повешены на alt+b / alt+n: аккорд Ctrl+K Ctrl+B к делу отношения не
// имеет, а палитра/меню увели бы фокус из редактора (см. userKeybindings). Alt+F
// занят мнемоникой меню File — отсюда alt+n («next»).

const longFile = resolve(repoRoot, "e2e", "fixtures", "gutterWidthFolding.ts");
const otherFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "navigation-history",
    title: "Navigation history: Go Back / Go Forward",
    open: [repoRoot, otherFile, longFile],
    cols: 110,
    rows: 30,
    userKeybindings: [
        { key: "alt+b", command: "workbench.action.navigateBack" },
        { key: "alt+n", command: "workbench.action.navigateForward" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("function"));

        // Точка, откуда уйдём: конец длинного файла.
        await editor.sendKey("Ctrl+End");
        await editor.waitForText((t) => /Ln 12[0-9], Col/u.test(t));
        await editor.capture("origin");

        // Уходим в соседнюю вкладку (Ctrl+6 — «Alternate Editor»).
        await editor.sendKey("Ctrl+6");
        await editor.waitForText((t) => t.includes("const greeting"));
        await editor.capture("jumped");

        // Go Back — каретка вернулась ровно в исходную позицию длинного файла,
        // а не просто «на прошлую вкладку в её начало».
        await editor.sendKey("Alt+B");
        await editor.waitForText((t) => /Ln 12[0-9], Col/u.test(t));
        await editor.capture("back");

        // Меню Go: Back и Forward видны, потому что идти есть куда в обе стороны.
        await editor.sendKey("Alt+G");
        await editor.waitForText((t) => t.includes("Back") && t.includes("Forward"));
        await editor.capture("go-menu");
        await editor.sendKey("Escape");

        // Go Forward — обратно туда, откуда вернулись.
        await editor.sendKey("Alt+N");
        await editor.waitForText((t) => t.includes("const greeting"));
        await editor.capture("forward");
    },
});
