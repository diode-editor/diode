import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";

import { defineScenario } from "./framework.ts";


const MARKER = "demo-assets";

/** Маленький: в кадр влезает весь список файлов. */
function makeFolder(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-empty-window-"));
    // Каталог-метка: диалог «только папки» показывает лишь каталоги — по нему видно, что папка догрузилась.
    mkdirSync(join(dir, MARKER));
    writeFileSync(join(dir, "greeting.ts"), 'export const greeting = "hello";\n');
    writeFileSync(join(dir, "README.md"), "# Demo\n");
    return dir;
}

const folder = makeFolder();

export default defineScenario({
    name: "empty-window",
    title: "Запуск без аргументов: пустое окно и выход из него через Open Folder",
    open: [],
    cols: 120,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("You have not yet opened a"));
        await editor.capture("empty");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+O");
        // Диалог стоит в домашнем каталоге: путь заменяем целиком; разделитель на конце входит в папку, а Enter без
        // подсвеченной строки выбирает её.
        await editor.waitForText((t) => t.includes("Open Folder") && t.includes(".."));
        await editor.capture("prompt");

        await editor.sendKey("Ctrl+A");
        await editor.sendText(folder + sep);
        // Длинный путь (временный каталог на Windows) прокручен — видна только его хвостовая часть.
        await editor.waitForText((t) => t.includes(basename(folder) + sep) && t.includes(MARKER));
        await editor.sendKey("Enter");
        // Дерево обязано наполниться, а не только потерять подсказку: новый корень грузится только refresh'ем.
        await editor.waitForText((t) => t.includes("greeting.ts") && !t.includes("You have not yet opened a"));
        await editor.capture("folder-opened");
    },
});
