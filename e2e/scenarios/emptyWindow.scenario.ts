import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// `diode` без аргументов: пустое окно. Папка не открыта (Explorer показывает
// welcome вместо дерева), текущий каталог не сканируется, вкладок нет —
// выйти из этого состояния можно командой Open Folder, которая наполняет дерево.
// Сам welcome и его кнопка — в сценарии `no-folder-welcome`.

/** Маленький воркспейс: в кадр целиком влезает весь его список файлов. */
function makeFolder(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-empty-window-"));
    writeFileSync(join(dir, "greeting.ts"), 'export const greeting = "hello";\n');
    writeFileSync(join(dir, "README.md"), "# Demo\n");
    return dir;
}

const folder = makeFolder();

export default defineScenario({
    name: "empty-window",
    title: "Запуск без аргументов: пустое окно и выход из него через Open Folder",
    // Ни одного позиционного аргумента — ровно то, что набирает человек.
    open: [],
    cols: 120,
    rows: 24,
    async run(editor) {
        // Сайдбар собран и без воркспейса: секция EXPLORER на месте, тела нет.
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("You have not yet opened a"));
        await editor.capture("empty");

        // Ctrl+K Ctrl+O — выход из пустого окна.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+O");
        await editor.waitForText((t) => t.includes("Open Folder") && t.includes("Enter a folder path"));
        await editor.capture("prompt");

        await editor.sendText(folder);
        await editor.sendKey("Enter");
        // Дерево обязано НАПОЛНИТЬСЯ, а не просто потерять подсказку: смена
        // корня строит новый TreeViewElement, который грузится только refresh'ем.
        await editor.waitForText((t) => t.includes("greeting.ts") && !t.includes("You have not yet opened a"));
        await editor.capture("folder-opened");
    },
});
