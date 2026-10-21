import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Сквозной путь, которого не видит ни один юнит: внешняя правка → inotify в watcher-процессе
// (`SubprocessTreeWatcher`) → IPC → git-расширение → буква M в дереве.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-git-live-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), "export const a = 1;\n");
    writeFileSync(join(repoDir, "readme.md"), "# demo\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    return repoDir;
}

const repoDir = makeRepo();

function rowFor(text: string, name: string): string | undefined {
    return text.split("\n").find((line) => line.includes(name));
}

export default defineScenario({
    name: "git-badge-live-update",
    title: "Правка файла снаружи редактора зажигает git-бейдж в дереве",
    open: [repoDir],
    cols: 100,
    rows: 20,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => rowFor(t, "app.ts") !== undefined);
        await editor.capture("clean");

        // Подписку git-расширение заводит при активации, которую старт окна не ждёт, а watcher ещё делает начальный
        // обход: ранняя правка события не даёт. Поэтому правку повторяем, пока событие не доедет; сломано слежение —
        // не доедет ни одна.
        const edited = (t: string): boolean => {
            const changed = rowFor(t, "app.ts");
            const untracked = rowFor(t, "untracked.md");
            return changed !== undefined && changed.includes("M") && untracked !== undefined;
        };
        for (let attempt = 1; ; attempt++) {
            writeFileSync(join(repoDir, "app.ts"), `export const a = ${String(attempt + 1)};\n`);
            writeFileSync(join(repoDir, "untracked.md"), `new ${String(attempt)}\n`);
            try {
                await editor.waitForText(edited, { timeoutMs: 3000 });
                break;
            } catch (err) {
                if (attempt === 5) throw err;
            }
        }
        await editor.capture("after-external-edit");
    },
});
