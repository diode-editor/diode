import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Граф — порт pipe-модели lazygit; Reset to Commit — отступление: в VS Code его нет.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Ветвление и merge — иначе граф выродится в палку. Subjects короткие: сайдбар в 30 колонок клипует длинные. */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-graph-demo-"));
    git(repoDir, "init", "-q", "-b", "main");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");

    const appFile = join(repoDir, "app.ts");
    writeFileSync(appFile, "export const version = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: старт");
    git(repoDir, "tag", "v1.0");

    git(repoDir, "checkout", "-q", "-b", "feature");
    writeFileSync(join(repoDir, "util.ts"), "export const twice = (n: number) => n * 2;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: утилита");

    git(repoDir, "checkout", "-q", "main");
    writeFileSync(appFile, "export const version = 2;\n");
    git(repoDir, "commit", "-aqm", "fix: версия");

    git(repoDir, "merge", "-q", "--no-ff", "feature", "-m", "merge: ветка");

    // Коммит поверх merge: одна дорожка против двух ниже — видно, что тема липнет к своей точке.
    writeFileSync(appFile, "export const version = 3;\n");
    git(repoDir, "commit", "-aqm", "chore: полировка");

    // Правка на диске — секция Source Control не пустует в кадре.
    writeFileSync(appFile, "export const version = 4;\n");
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "scm-graph",
    title: "View GRAPH: граф коммитов с ветвлением, бейджи refs и команды на коммите",
    open: [repoDir],
    cols: 100,
    // Контролы коммита занимают 5 строк секции — высоту берём с запасом.
    rows: 30,
    // Нужен extension host — коммиты публикует git-расширение.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("app.ts"));

        // GRAPH открывается свёрнутым — без раскрытия расширение не запустит `git log`; статус и лог приезжают асинхронно.
        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("GRAPH"));
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await editor.waitForText((t) => t.includes("merge: ветка") && t.includes("app.ts"));
        await editor.capture("sections");

        // Свёрнутая Source Control уносит и контролы коммита — app.ts виден только там.
        await editor.clickNode("#paneHeader-workbench-scm-changes", { dx: 3 });
        await editor.waitForText((t) => !t.includes("app.ts") && t.includes("feat: старт") && t.includes("◎"));
        await editor.capture("graph");

        const header = await editor.waitForNode("#paneHeader-workbench-scm-graph");
        const rowX = header.box.x + 4;
        const rowY = header.box.y + 1;
        await editor.sendMouse({ action: "press", button: "right", x: rowX, y: rowY });
        await editor.sendMouse({ action: "release", button: "right", x: rowX, y: rowY });
        await editor.waitForText((t) => t.includes("Reset to Commit") && t.includes("Cherry Pick"));
        await editor.capture("commit-menu");
        await editor.sendKey("Escape");

        // «⋯» — правые 3 колонки заголовка.
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: header.box.width - 2 });
        await editor.waitForText((t) => t.includes("Load More"));
        await editor.capture("more-actions-menu");
        await editor.sendKey("Escape");

        // Свёрнутый GRAPH не держит строк: ни укладки, ни `git log`, пока его не раскроют.
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await editor.waitForText((t) => t.includes("GRAPH") && !t.includes("feat: старт") && !t.includes("◎"));
        await editor.capture("graph-collapsed");

        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await editor.waitForText((t) => t.includes("feat: старт") && t.includes("◎"));
        await editor.capture("graph-restored");

        await editor.clickNode("#paneHeader-workbench-scm-changes", { dx: 3 });
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("fix: версия"));
    },
});
