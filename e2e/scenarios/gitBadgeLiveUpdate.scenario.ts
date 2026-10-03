import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Слежение за деревом живёт в отдельном процессе (`SubprocessTreeWatcher`), и
// «зелёные юниты по обе стороны IPC» ничего не говорят о том, доезжает ли
// событие до пользователя. Здесь доезжает целиком: файл правит кто-то снаружи
// редактора (этот сценарий, как это сделал бы терминал), watcher-процесс ловит
// inotify-событие, пачка едет через IPC в редактор, оттуда — в git-расширение,
// и в дереве появляется буква M. Ни одного из этих звеньев не видно ни в одном
// юните.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Чистый репозиторий: на старте в дереве нет ни одного бейджа. */
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

/** Строка дерева с этим файлом — и есть ли в ней буква статуса. */
function rowFor(text: string, name: string): string | undefined {
    return text.split("\n").find((line) => line.includes(name));
}

export default defineScenario({
    name: "git-badge-live-update",
    title: "Правка файла снаружи редактора зажигает git-бейдж в дереве",
    open: [repoDir],
    cols: 100,
    rows: 20,
    // Нужен extension host (буквы поставляет git-расширение) — как у прочих
    // extension-сценариев, гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // Дерево поднялось, репозиторий чистый: буквы статуса ещё нет.
        await editor.waitForText((t) => rowFor(t, "app.ts") !== undefined);
        await editor.capture("clean");

        // Правка «из терминала»: редактор этот файл не открывал и о записи не знает.
        // Единственный путь, по которому она может доехать до дерева, — событие из
        // watcher-процесса. Подписку git-расширение заводит при активации, а та
        // не ждётся стартом окна, и watcher-процесс ещё поднимается и делает
        // начальный обход: правка, сделанная раньше, события не даёт (её видел бы
        // разве что первичный `git status`). Поэтому правку повторяем, пока
        // событие не доедет; если слежение сломано, не доедет ни одна.
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
