import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

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

/**
 * Повторяет правку мимо редактора, пока вкладка на неё не отреагирует.
 *
 * Watcher рабочего дерева взводится асинхронно и МИМО того, что видно на
 * экране: расширение шлёт `createFileSystemWatcher` нотификацией, ядро заводит
 * обход в своём процессе, и chokidar ещё сканирует дерево. Первый кадр
 * («SOURCE CONTROL» и ветка) закрывает параллельный `git status` — про
 * слежение он не говорит ничего. Всё, что записано до конца начального скана,
 * гасит `ignoreInitial`, и событие теряется НАСОВСЕМ, а не опаздывает:
 * в прогоне 37195942480 список CHANGES так и остался пустым все 10 секунд.
 *
 * Это настоящий пробел слежения, а не только тестовый
 * (см. docs/TODO/FileTreePerformance.md, «Потерянные события в окне взвода»);
 * до его закрытия сценарий моделирует соседний терминал, который продолжает
 * писать, а не замирает после первой команды.
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
        // Чистое дерево на ветке main — точка отсчёта.
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("main"));
        await editor.capture("clean");

        // Правка и новый файл мимо редактора — как из соседнего терминала.
        // Про повтор записи — см. {@link writeUntilSeen}.
        await writeUntilSeen(
            editor,
            () => {
                writeFileSync(join(repoDir, "app.ts"), "export const version = 2;\n");
                writeFileSync(join(repoDir, "notes.md"), "# заметки\n");
            },
            (t) => t.includes("app.ts") && t.includes("notes.md"),
        );
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
