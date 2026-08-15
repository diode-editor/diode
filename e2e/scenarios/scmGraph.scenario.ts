import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// View-секция GRAPH контейнера Source Control: настоящий граф коммитов (порт
// pipe-модели lazygit) с бейджами ветки/тега и командами на коммите — включая
// Reset to Commit, которого нет в VS Code.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * Репозиторий с ветвлением: main, ветка feature и merge обратно в main — иначе
 * граф выродится в вертикальную палку и показывать будет нечего. Subjects
 * короткие: сайдбар в 30 колонок клипует длинные, а сценарий ждёт их точным
 * вхождением в кадр.
 */
function makeRepo(): { repoDir: string } {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-graph-demo-"));
    git(repoDir, "init", "-q", "-b", "main");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");

    const appFile = join(repoDir, "app.ts");
    writeFileSync(appFile, "export const version = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: старт");
    git(repoDir, "tag", "v1.0");

    // Ветка со своим коммитом — вторая дорожка графа.
    git(repoDir, "checkout", "-q", "-b", "feature");
    writeFileSync(join(repoDir, "util.ts"), "export const twice = (n: number) => n * 2;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: утилита");

    // Коммит в main поверх точки ветвления — дорожки расходятся.
    git(repoDir, "checkout", "-q", "main");
    writeFileSync(appFile, "export const version = 2;\n");
    git(repoDir, "commit", "-aqm", "fix: версия");

    // Merge без fast-forward — узел ◎ с двумя родителями.
    git(repoDir, "merge", "-q", "--no-ff", "feature", "-m", "merge: ветка");

    // Коммит поверх merge: у его строки одна дорожка против двух ниже — в кадре
    // видно, что тема липнет к своей точке, а не выравнивается по самой широкой.
    writeFileSync(appFile, "export const version = 3;\n");
    git(repoDir, "commit", "-aqm", "chore: полировка");

    // Правка на диске — секция Source Control не пустует в кадре.
    writeFileSync(appFile, "export const version = 4;\n");
    return { repoDir };
}

const { repoDir } = makeRepo();

export default defineScenario({
    name: "scm-graph",
    title: "View GRAPH: граф коммитов с ветвлением, бейджи refs и команды на коммите",
    open: [repoDir],
    cols: 100,
    // Контролы коммита занимают 5 строк секции — высоту берём с запасом.
    rows: 30,
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
                t.includes("GRAPH") &&
                t.includes("merge: ветка") &&
                t.includes("app.ts"),
        );
        await editor.capture("sections");

        // Клик по заголовку Source Control сворачивает секцию — вместе со списком
        // убираются и контролы коммита (app.ts виден только там), GRAPH забирает
        // высоту и показывает историю целиком: merge-узел ◎ и вторую дорожку.
        await editor.clickNode("#paneHeader-workbench-scm-changes", { dx: 3 });
        await editor.waitForText((t) => !t.includes("app.ts") && t.includes("feat: старт") && t.includes("◎"));
        await editor.capture("graph");

        // Правый клик по строке коммита — контекстное меню команд графа.
        const header = await editor.waitForNode("#paneHeader-workbench-scm-graph");
        const rowX = header.box.x + 4;
        const rowY = header.box.y + 1;
        await editor.sendMouse({ action: "press", button: "right", x: rowX, y: rowY });
        await editor.sendMouse({ action: "release", button: "right", x: rowX, y: rowY });
        await editor.waitForText((t) => t.includes("Reset to Commit") && t.includes("Cherry Pick"));
        await editor.capture("commit-menu");
        await editor.sendKey("Escape");

        // Кнопка «⋯» заголовка GRAPH (правые 3 колонки) открывает меню секции.
        // Refresh из него переехал в inline-кнопку заголовка, в меню осталась
        // подгрузка следующей страницы истории.
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: header.box.width - 2 });
        await editor.waitForText((t) => t.includes("Load More"));
        await editor.capture("more-actions-menu");
        await editor.sendKey("Escape");

        // Развернуть Source Control обратно — секции снова делят высоту.
        await editor.clickNode("#paneHeader-workbench-scm-changes", { dx: 3 });
        await editor.waitForText((t) => t.includes("app.ts") && t.includes("fix: версия"));
    },
});
