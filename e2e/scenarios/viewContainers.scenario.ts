import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Общая модель view-контейнеров: заголовок активити со своим «⋯»-меню,
// подменю-переключатель видимости секций и кнопки в заголовках view.
// Демонстрируем на Source Control — единственном контейнере с двумя секциями
// (CHANGES + GRAPH), где видно и заголовок контейнера, и заголовки секций.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-views-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const greet = (n: string) => "hi " + n;\n');
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), 'export const greet = (n: string) => "hello " + n;\n');
    return repoDir;
}

const repoDir = makeRepo();

export default defineScenario({
    name: "view-containers",
    title: "Контейнеры view: заголовок активити, «⋯» и переключатель секций",
    open: [repoDir],
    cols: 100,
    rows: 30,
    // Секции SOURCE CONTROL наполняет git-расширение — нужен extension host.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        // Explorer — контейнер с единственной секцией: заголовки слиты, в строке
        // заголовка живут кнопки New File / New Folder / Refresh и «⋯».
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("app.ts"));
        await editor.capture("explorer-title");

        // Source Control — две секции: у контейнера свой заголовок, у CHANGES и
        // GRAPH — свои, сворачиваемые.
        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("CHANGES") && t.includes("GRAPH"));
        await editor.capture("container-and-sections");

        // «⋯» заголовка контейнера: команды контейнера + подменю Views.
        const header = await editor.waitForNode("#viewContainerHeader-scm");
        await editor.click(header.box.x + header.box.width - 2, header.box.y);
        await editor.waitForText((t) => t.includes("Views"));
        await editor.capture("container-menu");

        // Подменю Views — чекбоксы видимости секций.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("CHANGES") && t.includes("GRAPH"));
        await editor.capture("views-submenu");

        // Скрываем GRAPH: контейнер остаётся с одной видимой секцией и сам
        // становится merged — заголовок контейнера исчезает, а CHANGES несёт
        // его название.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("GRAPH"));
        await editor.capture("merged-after-hide");
    },
});
