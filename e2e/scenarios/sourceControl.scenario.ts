import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Вьюлет Source Control в сайдбаре (вместо Explorer, как в VS Code): список
// изменённых файлов от git-расширения; двойной клик открывает дифф этапа 5.
// Activity bar'а нет — Explorer ↔ Source Control переключает команда
// (`workbench.view.scm`). Изменения делаем НА ДИСКЕ — список берётся из
// `git status`, который видит только сохранённое.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Репозиторий: закоммиченные файлы (в т.ч. вложенный) + правки на диске + untracked. */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "vexx-scm-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    // Имя сортируется раньше extra.ts, чтобы модифицированный (диффабельный) файл
    // был первой строкой списка — по нему и открываем дифф.
    const trackedFile = join(repoDir, "app.ts");
    writeFileSync(trackedFile, ["export function greet(name: string) {", '    return "hi " + name;', "}", ""].join("\n"));
    // Вложенный файл — для кадра tree-режима (компакт-цепочка src/util одним узлом).
    const nestedFile = join(repoDir, "src", "util", "format.ts");
    execFileSync("mkdir", ["-p", join(nestedFile, "..")]);
    writeFileSync(nestedFile, "export const pad = (s: string) => s.padEnd(8);\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    // Правим на диске (modified) и добавляем новый файл (untracked).
    writeFileSync(trackedFile, ["export function greet(name: string) {", '    return "hello " + name;', "}", ""].join("\n"));
    writeFileSync(nestedFile, "export const pad = (s: string) => s.padEnd(12);\n");
    writeFileSync(join(repoDir, "extra.ts"), "export const answer = 42;\n");
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "source-control",
    title: "Source Control в сайдбаре: список изменений и дифф по клику",
    open: [repoDir],
    cols: 100,
    rows: 22,
    // Нужен extension host — набор изменений публикует git-расширение.
    skipOn: ["win32", "darwin"],
    // Переключение на Source Control и режимов — через user-кейбинды
    // (детерминированно, без палитры). Буквы НЕ мнемонические: F/E/S/V/G/H — меню-бар.
    userKeybindings: [
        { key: "alt+c", command: "workbench.view.scm" },
        { key: "alt+t", command: "scm.action.viewAsTree" },
    ],
    async run(editor) {
        // Готовность: Explorer показывает файлы (папка открылась, расширение
        // считает git status).
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("extra.ts"));

        // Переключаем сайдбар на Source Control (Explorer сменяется списком) и ждём
        // НАПОЛНЕННЫЙ список — расширение уже опубликовало набор.
        await editor.sendKey("Alt+C");
        await editor.waitForText(
            (t) => t.includes("SOURCE CONTROL") && t.includes("app.ts") && t.includes("extra.ts"),
        );
        const list = await editor.waitForNode("#changesView");
        await editor.capture("changes");

        // Двойной клик по первой строке (app.ts, modified) открывает вкладку-
        // смотрелку этапа 5. Строка списка — под заголовком рамки, поэтому y+1.
        // Двойной, а не одиночный: одиночный клик по дереву лишь выделяет,
        // активирует dblclick. Шлём 4 события подряд без settle, чтобы уложиться
        // в окно распознавания двойного клика (300 мс).
        const x = list.box.x + 2;
        const y = list.box.y + 1;
        await editor.sendMouse({ action: "press", button: "left", x, y });
        await editor.sendMouse({ action: "release", button: "left", x, y });
        await editor.sendMouse({ action: "press", button: "left", x, y });
        await editor.sendMouse({ action: "release", button: "left", x, y });
        await editor.waitForText((t) => t.includes("↔ HEAD"));
        await editor.capture("diff");

        // Режим «дерево»: пути сворачиваются в компакт-папки (src/util одним узлом
        // с шевроном), файлы — под ними.
        await editor.sendKey("Alt+T");
        await editor.waitForText((t) => t.includes("src/util") && !t.includes("src/util/format.ts"));
        await editor.capture("changes-tree");

        // Контекстное меню строки: правый клик по app.ts (в дереве: src/util,
        // format.ts, app.ts, extra.ts → третья строка).
        const rows = await editor.waitForNode("#changesList");
        const menuX = rows.box.x + 2;
        const menuY = rows.box.y + 2;
        await editor.sendMouse({ action: "press", button: "right", x: menuX, y: menuY });
        await editor.sendMouse({ action: "release", button: "right", x: menuX, y: menuY });
        await editor.waitForText((t) => t.includes("Open File") && t.includes("Open Changes"));
        await editor.capture("context-menu");
        await editor.sendKey("Escape");

        // Инлайн-кнопка Open File (глиф у правого края строки): открывает сам файл,
        // а не дифф — кликаем по untracked extra.ts (четвёртая строка дерева).
        await editor.clickNode("#changesList", { dx: rows.box.width - 3, dy: 3 });
        await editor.waitForText((t) => t.includes("export const answer = 42;"));
        await editor.capture("open-file-button");
    },
});
