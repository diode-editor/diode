import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OPEN_FILE_BUTTON_WIDTH } from "../../src/vs/workbench/contrib/scm/browser/scmChangeRows.ts";

import { defineScenario } from "./framework.ts";

// Изменения делаем НА ДИСКЕ: список берётся из `git status`, который видит только сохранённое.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-demo-"));
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
    // 4 верхние строки секции — контролы коммита; высоты должно хватить и на обе группы.
    rows: 30,
    // Нужен extension host — набор изменений публикует git-расширение.
    skipOn: ["win32", "darwin"],
    // Буквы не мнемонические: F/E/S/V/G/H — меню-бар.
    userKeybindings: [
        { key: "alt+c", command: "workbench.view.scm" },
        { key: "alt+t", command: "scm.action.viewAsTree" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("extra.ts"));

        await editor.sendKey("Alt+C");
        await editor.waitForText(
            (t) => t.includes("SOURCE CONTROL") && t.includes("app.ts") && t.includes("extra.ts"),
        );
        const list = await editor.waitForNode("#changesView");
        await editor.capture("changes");

        // Shift+F10 — через единое событие contextmenu движка; курсор списка стоит на заголовке «Changes».
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Open File") && t.includes("Open Changes"));
        await editor.capture("context-menu");
        await editor.sendKey("Escape");

        // Двойной клик: одиночный по дереву лишь выделяет. 4 события подряд без settle — в окно двойного клика (300 мс).
        const x = list.box.x + 2;
        const y = list.box.y + 1; // первая строка — заголовок группы «Changes»
        await editor.sendMouse({ action: "press", button: "left", x, y });
        await editor.sendMouse({ action: "release", button: "left", x, y });
        await editor.sendMouse({ action: "press", button: "left", x, y });
        await editor.sendMouse({ action: "release", button: "left", x, y });
        await editor.waitForText((t) => t.includes("↔ HEAD"));
        await editor.capture("diff");

        await editor.sendKey("Alt+T");
        await editor.waitForText((t) => t.includes("src/util") && !t.includes("src/util/format.ts"));
        await editor.capture("changes-tree");

        // В дереве: Changes, src/util, format.ts, app.ts — app.ts четвёртая строка.
        const rows = await editor.waitForNode("#changesList");
        const menuX = rows.box.x + 2;
        const menuY = rows.box.y + 3;
        await editor.sendMouse({ action: "press", button: "right", x: menuX, y: menuY });
        await editor.sendMouse({ action: "release", button: "right", x: menuX, y: menuY });
        await editor.waitForText((t) => t.includes("Open File") && t.includes("Open Changes"));
        await editor.capture("context-menu");
        await editor.sendKey("Escape");

        // Инлайн-кнопка раскрывается только под указателем — сначала наводим. extra.ts — пятая строка дерева
        // (untracked едет в той же группе).
        const buttonRowY = rows.box.y + 4;
        await editor.sendMouse({ action: "move", button: "none", x: rows.box.x, y: buttonRowY });
        await editor.capture("open-file-button");

        const buttonX = rows.box.x + rows.box.width - 1 - OPEN_FILE_BUTTON_WIDTH;
        await editor.sendMouse({ action: "press", button: "left", x: buttonX, y: buttonRowY });
        await editor.sendMouse({ action: "release", button: "left", x: buttonX, y: buttonRowY });
        await editor.waitForText((t) => t.includes("export const answer = 42;"));
        await editor.capture("open-file");
    },
});
