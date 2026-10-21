import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Кадры заголовков подряд (EXPLORER → SEARCH → SOURCE CONTROL): название вьюлета обязано выглядеть одинаково —
// у merged его несёт PaneHeaderElement, у SCM ViewContainerHeaderElement, оба читают `sideBarTitle.foreground`.

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
        await editor.waitForText((t) => t.includes("EXPLORER") && t.includes("app.ts"));
        await editor.capture("explorer-title");

        // Свой бинд не заводим: Alt+<буква> ушёл бы в мнемонику меню, а Ctrl+K F работает на любом терминале.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("f");
        await editor.waitForText((t) => t.includes("SEARCH"));
        await editor.capture("search-title");

        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("CHANGES") && t.includes("GRAPH"));
        await editor.capture("container-and-sections");

        const header = await editor.waitForNode("#viewContainerHeader-scm");
        await editor.click(header.box.x + header.box.width - 2, header.box.y);
        await editor.waitForText((t) => t.includes("Views"));
        await editor.capture("container-menu");

        // Views — первый пункт и выделен при открытии.
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("CHANGES") && t.includes("GRAPH"));
        await editor.capture("views-submenu");

        // Одна видимая секция делает контейнер merged: его название несёт CHANGES.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("GRAPH"));
        await editor.capture("merged-after-hide");
    },
});
