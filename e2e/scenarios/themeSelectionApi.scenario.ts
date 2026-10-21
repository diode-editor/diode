import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


// Файл неизвестного языка и без папки-воркспейса: не будить tsserver, чей
// спиннер двигает сегменты полосы (та же причина, что в statusBarExtension).
const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.hello");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-theme-selection");

export default defineScenario({
    name: "theme-selection-api",
    title: "window.activeColorTheme и onDidChangeTextEditorSelection",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Только Linux: субпроцесс расширений на Windows флейкает.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Theme Dark"), { timeoutMs: 20_000 });
        await editor.capture("activated");

        // Стрелка — команда с кейбинда, но для расширения это Keyboard, как в VS Code.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Sel 2:2 Keyboard"), { timeoutMs: 5000 });
        await editor.capture("keyboard");

        // Координата — от левого края экрана: сайдбар есть и без папки, текст начинается около 36-й колонки, клик
        // правее конца строки 4 клампится в `Sel 4:12`. Предел 5 с, как у клавиатуры: пропущенный клик был багом
        // движка (tuidom#22, кадр не рисовался), а не медленным раннером; после правки — 51–75 мс.
        await editor.click(50, 5);
        await editor.waitForText((t) => t.includes("Sel 4:12 Mouse"), { timeoutMs: 5000 });
        await editor.capture("mouse");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+T");
        await editor.waitForText((t) => t.includes("Light+"));
        await editor.sendText("Light+");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Theme Light"), { timeoutMs: 5000 });
        await editor.capture("light-theme");
    },
});
