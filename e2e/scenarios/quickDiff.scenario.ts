import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Живые change-bars в гуттере: дифф считает ядро против БУФЕРА, а не против
// файла на диске. Раньше ханки считало git-расширение по `git diff` на диске
// с пересчётом по onDidSaveTextDocument — бары стояли до Ctrl+S. Сценарий
// показывает ровно это: печатаем НЕ СОХРАНЯЯ, и бар появляется сразу.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Свой временный репозиторий — чтобы «чистый» кадр не зависел от состояния diode. */
function makeRepo(): { repoDir: string; trackedFile: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-quickdiff-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const trackedFile = join(repoDir, "greeting.txt");
    writeFileSync(trackedFile, "alpha\nbravo\ncharlie\ndelta\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    return { repoDir, trackedFile };
}

const { repoDir, trackedFile } = makeRepo();

export default defineScenario({
    name: "quick-diff-live-gutter",
    title: "Change-bars двигаются при наборе, до сохранения",
    open: [repoDir, trackedFile],
    cols: 90,
    rows: 16,
    // Нужен extension host (git-расширение отдаёт версию из HEAD) — как у
    // прочих extension-сценариев, гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // Файл совпадает с HEAD — гуттер пуст.
        await editor.waitForText((t) => t.includes("charlie"));
        await editor.capture("clean");

        // Правим вторую строку и НЕ сохраняем.
        await editor.sendKey("ArrowDown");
        await editor.sendText("XX");
        await editor.waitForText((t) => t.includes("XXbravo"));

        // Бар появляется от самой правки: до старого пересчёта по сохранению
        // здесь было бы пусто.
        await editor.waitForText((t) => t.includes("┋"));
        await editor.capture("live-bars");
    },
});
