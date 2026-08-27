import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Буква git-статуса в дереве файлов стоит с отступом в одну колонку от правого
// края панели (не прилипает к нему), а фон выделения строки при этом заливает
// строку до самого края — отступ живёт внутри строки бейджа (getTreeItem
// дописывает пробел), по тому же принципу, что leftPadding у TreeViewElement.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Свой временный репозиторий — чтобы кадр не зависел от состояния diode. */
function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-explorer-badge-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), "export const a = 1;\n");
    writeFileSync(join(repoDir, "readme.md"), "# demo\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    // Изменённый файл (M) + неотслеживаемый (U) — два бейджа в дереве.
    writeFileSync(join(repoDir, "app.ts"), "export const a = 2;\n");
    writeFileSync(join(repoDir, "untracked.md"), "new\n");
    return repoDir;
}

const repoDir = makeRepo();

export default defineScenario({
    name: "explorer-git-badge",
    title: "Буква git-статуса в дереве отступает от правого края",
    open: [repoDir],
    cols: 100,
    rows: 20,
    // Нужен extension host (буквы поставляет git-расширение) — как у прочих
    // extension-сценариев, гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // Ждём декорации от git-расширения: буква M у app.ts.
        await editor.waitForText((t) => {
            const row = t.split("\n").find((line) => line.includes("app.ts"));
            return row !== undefined && row.includes("M");
        });
        // Один кадр показывает всё: буквы M/U на колонку левее края панели, а
        // строка под курсором (app.ts) залита фоном выделения до самого края.
        await editor.capture("badges");
    },
});
