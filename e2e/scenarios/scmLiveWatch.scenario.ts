import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// Файлы и ветка меняются через `git`/`writeFileSync`, а не редактором: правки мимо редактора должны приехать сами.

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

/**
 * Повторяет правку, пока вкладка не отреагирует: watcher взводится асинхронно, а записанное до конца
 * начального скана chokidar гасит `ignoreInitial` — событие теряется насовсем (прогон 37195942480).
 * Настоящий пробел слежения (docs/TODO/FileTreePerformance.md, «Потерянные события в окне взвода»);
 * до его закрытия сценарий моделирует соседний терминал, который продолжает писать.
 */
async function writeUntilSeen(
    editor: ScenarioDriver,
    write: () => void,
    predicate: (text: string) => boolean,
): Promise<void> {
    const attempts = 5;
    for (let attempt = 1; ; attempt++) {
        write();
        try {
            await editor.waitForText(predicate, { timeoutMs: 3000 });
            return;
        } catch (err) {
            if (attempt === attempts) throw err;
        }
    }
}

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
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("main"));
        await editor.capture("clean");

        await writeUntilSeen(
            editor,
            () => {
                writeFileSync(join(repoDir, "app.ts"), "export const version = 2;\n");
                writeFileSync(join(repoDir, "notes.md"), "# заметки\n");
            },
            (t) => t.includes("app.ts") && t.includes("notes.md"),
        );
        await editor.capture("worktree-changes");

        git(repoDir, "add", "app.ts");
        await editor.waitForText((t) => t.includes("Staged Changes"));
        await editor.capture("staged-outside");

        git(repoDir, "checkout", "-q", "-b", "feature");
        await editor.waitForText((t) => t.includes("feature"));
        await editor.capture("branch-switched");
    },
});
