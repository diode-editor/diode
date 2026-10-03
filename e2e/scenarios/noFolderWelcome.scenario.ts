import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Паритет состояния «папка не открыта»: редактор поднят на ОДНОМ файле. В этом
// состоянии сайдбар не молчит — Explorer показывает welcome с кнопкой Open
// Folder (аналог `viewsWelcome` эталона), Search и Source Control честно
// говорят, что им нужна папка, а магазин расширений работает как обычно: папка
// ему не нужна. Выход из состояния — Enter по кнопке welcome: фокус стоит на
// ней сразу, как только вьюлет показан.

/** Одинокий файл вне воркспейса: его и открывает редактор, папку не получая. */
function makeLonelyFile(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-lonely-"));
    const file = join(dir, "lonely.txt");
    writeFileSync(file, "hello from a lonely file\n");
    return file;
}

/** Папка, которой заканчивается демо: её список файлов целиком влезает в кадр. */
function makeFolder(): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-no-folder-"));
    writeFileSync(join(dir, "greeting.ts"), 'export const greeting = "hello";\n');
    writeFileSync(join(dir, "README.md"), "# Demo\n");
    return dir;
}

const lonelyFile = makeLonelyFile();
const folder = makeFolder();
// Реестр-фикстура вместо публичного магазина: демо не должно зависеть от сети.
const registry = resolve(repoRoot, "e2e", "fixtures", "registry");

export default defineScenario({
    name: "no-folder-welcome",
    title: "Папка не открыта: welcome в сайдбаре и выход из состояния",
    // Только файл — ни одного каталога в аргументах.
    open: [lonelyFile],
    extraArgs: [`--registry=${registry}`],
    cols: 120,
    rows: 26,
    async run(editor) {
        // 1. Explorer: вместо плоской строки — текст и кнопка.
        await editor.waitForText((t) => t.includes("You have not yet opened a") && t.includes("[ Open Folder ]"));
        await editor.capture("explorer-welcome");

        // 2. Search без папки не делает вид, что работает.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("f");
        await editor.waitForText((t) => t.includes("Search needs an open folder."));
        await editor.capture("search-welcome");

        // 3. Source Control — то же самое, вместо поля коммита.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("g");
        await editor.waitForText((t) => t.includes("To use source control, open a"));
        await editor.capture("scm-welcome");

        // 4. Магазин расширений папки не требует и работает целиком: каталог
        //    отрисован, поиск по нему фильтрует.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("x");
        await editor.waitForText((t) => t.includes("MARKETPLACE") && t.includes("Acme Sample"));
        await editor.sendText("tab");
        await editor.waitForText((t) => t.includes("Tab Setter") && !t.includes("Acme Sample"));
        await editor.capture("extensions-without-folder");

        // 5. Выход из состояния: Explorer → фокус уже на кнопке → Enter.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("e");
        await editor.waitForText((t) => t.includes("[ Open Folder ]"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Open Folder") && t.includes("Enter a folder path"));
        await editor.sendText(folder);
        await editor.sendKey("Enter");
        // Дерево обязано НАПОЛНИТЬСЯ, а не просто потерять welcome.
        await editor.waitForText((t) => t.includes("greeting.ts") && !t.includes("You have not yet opened a"));
        await editor.capture("folder-opened");

        // 6. И поиск с SCM после этого — рабочие, а не welcome.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("f");
        await editor.waitForText((t) => !t.includes("Search needs an open folder.") && t.includes("SEARCH"));
        await editor.sendText("greeting");
        await editor.waitForText((t) => t.includes("greeting.ts"));
        await editor.capture("search-works");
    },
});
