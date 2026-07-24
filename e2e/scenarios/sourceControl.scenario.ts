import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Вьюлет Source Control в сайдбаре (вместо Explorer, как в VS Code): список
// изменённых файлов от git-расширения; двойной клик открывает дифф этапа 5.
// Activity bar'а нет — Explorer ↔ Source Control переключает команда
// (`workbench.view.scm`). Изменения делаем НА ДИСКЕ — список берётся из
// `git status`, который видит только сохранённое.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Репозиторий: закоммиченный файл + его правка на диске + untracked-файл. */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "vexx-scm-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    // Имя сортируется раньше extra.ts, чтобы модифицированный (диффабельный) файл
    // был первой строкой списка — по нему и открываем дифф.
    const trackedFile = join(repoDir, "app.ts");
    writeFileSync(trackedFile, ["export function greet(name: string) {", '    return "hi " + name;', "}", ""].join("\n"));
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "init");
    // Правим на диске (modified) и добавляем новый файл (untracked).
    writeFileSync(trackedFile, ["export function greet(name: string) {", '    return "hello " + name;', "}", ""].join("\n"));
    writeFileSync(join(repoDir, "extra.ts"), "export const answer = 42;\n");
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "source-control",
    title: "Source Control в сайдбаре: список изменений и дифф по клику",
    open: [repoDir],
    cols: 100,
    rows: 22,
    // Нужен extension host — набор изменений публикует git-расширение.
    skipOn: ["win32", "darwin"],
    // Переключение на Source Control — через user-кейбинд (детерминированно, без
    // палитры). Букву берём НЕ мнемоническую: F/E/S/V/G/H — это меню-бар.
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        // Готовность: Explorer показывает файлы (папка открылась, расширение
        // считает git status).
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("extra.ts"));

        // Переключаем сайдбар на Source Control (Explorer сменяется списком) и ждём
        // НАПОЛНЕННЫЙ список — расширение уже опубликовало набор.
        await editor.sendKey("Alt+C");
        await editor.waitForText(
            (t) => t.includes("SOURCE CONTROL") && t.includes("app.ts") && t.includes("extra.ts"),
        );
        const list = await editor.waitForNode("#changesView");
        await editor.capture("changes");

        // Двойной клик по первой строке (app.ts, modified) открывает вкладку-
        // смотрелку этапа 5. Строка списка — под заголовком рамки, поэтому y+1.
        // Двойной, а не одиночный: одиночный клик по дереву лишь выделяет,
        // активирует dblclick. Шлём 4 события подряд без settle, чтобы уложиться
        // в окно распознавания двойного клика (300 мс).
        const x = list.box.x + 2;
        const y = list.box.y + 1;
        await editor.sendMouse({ action: "press", button: "left", x, y });
        await editor.sendMouse({ action: "release", button: "left", x, y });
        await editor.sendMouse({ action: "press", button: "left", x, y });
        await editor.sendMouse({ action: "release", button: "left", x, y });
        await editor.waitForText((t) => t.includes("↔ HEAD"));
        await editor.capture("diff");
    },
});
