import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Живое слежение за репозиторием: правки, сделанные МИМО редактора (терминал
// рядом, чужой инструмент, скрипт), приезжают во вкладку Source Control и в
// статус-бар сами. Сценарий именно поэтому меняет файлы и ветку через `git`/
// `writeFileSync`, а не редактором: до появления watcher'ов рабочего дерева
// такой сценарий не работал вовсе — кадр «после» оставался равен кадру «до».

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-live-watch-demo-"));
    git(repoDir, "init", "-q", "-b", "main");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), "export const version = 1;\n");
    writeFileSync(join(repoDir, "util.ts"), "export const twice = (n: number) => n * 2;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: старт");
    return repoDir;
}

const repoDir = makeRepo();

export default defineScenario({
    name: "scm-live-watch",
    title: "Source Control оживает от правок мимо редактора (внешний git и запись на диск)",
    open: [repoDir],
    cols: 100,
    rows: 24,
    // Нужен extension host — статус публикует git-расширение.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        await editor.sendKey("Alt+C");
        // Чистое дерево на ветке main — точка отсчёта.
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("main"));
        await editor.capture("clean");

        // Правка и новый файл мимо редактора — как из соседнего терминала.
        writeFileSync(join(repoDir, "app.ts"), "export const version = 2;\n");
        writeFileSync(join(repoDir, "notes.md"), "# заметки\n");
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("notes.md"));
        await editor.capture("worktree-changes");

        // `git add` из терминала — файл переезжает в Staged Changes.
        git(repoDir, "add", "app.ts");
        await editor.waitForText((t) => t.includes("Staged Changes"));
        await editor.capture("staged-outside");

        // Смена ветки снаружи — статус-бар и заголовок догоняют сами.
        git(repoDir, "checkout", "-q", "-b", "feature");
        await editor.waitForText((t) => t.includes("feature"));
        await editor.capture("branch-switched");
    },
});
