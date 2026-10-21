import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Удалённый файл, как в эталоне, в папку не всплывает.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

const ORIGINAL = "export const a = 1;\n";

/** Свой временный репозиторий — чтобы кадр не зависел от состояния diode. */
function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-explorer-folder-deco-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    mkdirSync(join(repoDir, "src", "lib"), { recursive: true });
    mkdirSync(join(repoDir, "old"));
    mkdirSync(join(repoDir, "docs"));
    writeFileSync(join(repoDir, "src", "lib", "util.ts"), ORIGINAL);
    writeFileSync(join(repoDir, "old", "gone.ts"), ORIGINAL);
    writeFileSync(join(repoDir, "old", "keep.ts"), ORIGINAL);
    writeFileSync(join(repoDir, "docs", "guide.md"), "# guide\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    // src/lib/util.ts изменён (M) — «●» у src; old/gone.ts удалён (D) — у old пусто.
    writeFileSync(join(repoDir, "src", "lib", "util.ts"), "export const a = 2;\n");
    rmSync(join(repoDir, "old", "gone.ts"));
    return repoDir;
}

const repoDir = makeRepo();

function rowFor(text: string, name: string): string | undefined {
    return text.split("\n").find((line) => new RegExp(`(^|\\s)${name}(\\s|$)`).test(line));
}

export default defineScenario({
    name: "explorer-git-folder-decoration",
    title: "Папка с изменёнными файлами — цвет и «●», чистая — без декораций",
    open: [repoDir],
    cols: 100,
    rows: 20,
    // Нужен extension host (декорации поставляет git-расширение) — как у прочих
    // extension-сценариев, гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // «●» у src, а у old — нет: удалённый файл к папке не всплывает.
        await editor.waitForText(
            (t) => rowFor(t, "src")?.includes("●") === true && rowFor(t, "old")?.includes("●") === false,
        );
        await editor.capture("modified-inside");

        // Файл снова чистый (правка «из терминала»): «●» у src гаснет. Правку
        // повторяем, пока событие watcher'а не доедет — как в git-badge-live-update.
        for (let attempt = 1; ; attempt++) {
            writeFileSync(join(repoDir, "src", "lib", "util.ts"), ORIGINAL);
            try {
                await editor.waitForText((t) => rowFor(t, "src")?.includes("●") === false, { timeoutMs: 3000 });
                break;
            } catch (err) {
                if (attempt === 5) throw err;
            }
        }
        await editor.capture("clean-again");
    },
});
