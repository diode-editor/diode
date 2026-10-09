import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Переименование ОТКРЫТОГО файла в проводнике: вкладка едет за файлом (как
// `EditorService.handleMovedFile` в VS Code). Баг из догфудинга: вкладка
// оставалась на старом пути, первое же сохранение воскрешало старый файл, и git
// показывал пару «новый U + старый M» вместо одного переименованного файла.
//
// Сценарий: репозиторий с одним закоммиченным файлом, файл открыт; F2 в дереве
// → новое имя → вкладка сменила имя; правка + Ctrl+S → в дереве только новый
// файл (untracked, U), старого нет нигде — ни во вкладке, ни в дереве.

const OLD_NAME = "notes.txt";
const NEW_NAME = "guide.txt";

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-rename-open-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, OLD_NAME), "Project notes.\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    return repoDir;
}

const repoDir = makeRepo();

/** Строка кадра с этим именем (дерево и полоса вкладок — в одной строке кадра). */
function rowsWith(text: string, name: string): string[] {
    return text.split("\n").filter((line) => line.includes(name));
}

export default defineScenario({
    name: "rename-open-file",
    title: "Переименованный в проводнике открытый файл: вкладка едет за ним",
    open: [repoDir, join(repoDir, OLD_NAME)],
    cols: 100,
    rows: 20,
    // Буквы статуса в дереве ставит git-расширение (extension host) — как у
    // прочих extension-сценариев, только Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => rowsWith(t, OLD_NAME).length > 0 && t.includes("Project notes."));

        // Фокус в дерево через меню View (как в сценарии rename): курсор встаёт
        // на единственный файл.
        await editor.sendKey("Alt+V");
        await editor.waitForText((t) => t.includes("Explorer"));
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.capture("open");

        await editor.sendKey("F2");
        await editor.waitForText((t) => t.includes("Rename") && t.includes(OLD_NAME));
        for (let i = 0; i < OLD_NAME.length; i++) await editor.sendKey("Backspace");
        await editor.sendText(NEW_NAME);
        await editor.waitForText((t) => t.includes("Rename") && t.includes(NEW_NAME));
        await editor.sendKey("Enter");

        // И дерево, и вкладка — под новым именем; старого имени в кадре нет.
        await editor.waitForText((t) => rowsWith(t, NEW_NAME).length > 0 && !t.includes(OLD_NAME));
        await editor.capture("renamed");

        // Правка и сохранение во вкладке: пишется НОВЫЙ файл, старый не воскресает.
        const tab = await editor.waitForNode("EditorElement");
        await editor.click(tab.box.x + 2, tab.box.y);
        await editor.sendKey("End");
        await editor.sendText(" Edited.");
        await editor.sendKey("Ctrl+S");
        await editor.waitForText(
            (t) =>
                t.includes("Project notes. Edited.") &&
                rowsWith(t, NEW_NAME).some((line) => /\bU\b/.test(line)) &&
                !t.includes(OLD_NAME),
        );
        await editor.capture("saved");
    },
});
