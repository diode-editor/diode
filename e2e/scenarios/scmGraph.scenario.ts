import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// View-секции сайдбара (PaneView): контейнер Source Control разбит на CHANGES и
// GRAPH — сворачиваемые секции с заголовками и меню «⋯». GRAPH — последние
// коммиты от git-расширения (пока тривиальный список, настоящий граф позже).

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * Репозиторий: три коммита истории + правка на диске (наполняет CHANGES).
 * Subjects короткие — сайдбар в 30 колонок клипует длинные, а сценарий ждёт
 * их точным вхождением в кадр.
 */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "vexx-graph-demo-"));
    git(repoDir, "init", "-q");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const appFile = join(repoDir, "app.ts");
    writeFileSync(appFile, "export const version = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: старт");
    writeFileSync(appFile, "export const version = 2;\n");
    git(repoDir, "commit", "-aqm", "fix: версия");
    writeFileSync(join(repoDir, "util.ts"), "export const twice = (n: number) => n * 2;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: утилита");
    // Правка на диске — секция CHANGES не пустует в кадре.
    writeFileSync(appFile, "export const version = 3;\n");
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "scm-graph",
    title: "View-секции Source Control: CHANGES + GRAPH, сворачивание и меню «⋯»",
    open: [repoDir],
    cols: 100,
    rows: 24,
    // Нужен extension host — коммиты публикует git-расширение.
    skipOn: ["win32", "darwin"],
    userKeybindings: [{ key: "alt+c", command: "workbench.view.scm" }],
    async run(editor) {
        // Готовность: Explorer показал файлы (папка открыта, расширение стартует).
        await editor.waitForText((t) => t.includes("app.ts"));

        // Source Control: контейнер с двумя секциями. Ждём и заголовки, и данные
        // обеих (расширение публикует статус и лог асинхронно).
        await editor.sendKey("Alt+C");
        await editor.waitForText(
            (t) =>
                t.includes("SOURCE CONTROL") &&
                t.includes("CHANGES") &&
                t.includes("GRAPH") &&
                t.includes("feat: утилита") &&
                t.includes("app.ts"),
        );
        await editor.capture("sections");

        // Клик по заголовку CHANGES сворачивает секцию — её список исчезает с
        // экрана (app.ts виден только там), GRAPH забирает высоту.
        await editor.clickNode("#paneHeader-workbench-scm-changes", { dx: 3 });
        await editor.waitForText((t) => !t.includes("app.ts") && t.includes("feat: старт"));
        await editor.capture("changes-collapsed");

        // Кнопка «⋯» заголовка GRAPH (правые 3 колонки) открывает меню секции.
        const graphHeader = await editor.waitForNode("#paneHeader-workbench-scm-graph");
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: graphHeader.box.width - 2 });
        await editor.waitForText((t) => t.includes("Refresh"));
        await editor.capture("more-actions-menu");
        await editor.sendKey("Escape");

        // Развернуть CHANGES обратно — секции снова делят высоту.
        await editor.clickNode("#paneHeader-workbench-scm-changes", { dx: 3 });
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("fix: версия"));
    },
});
