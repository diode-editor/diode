import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// Дефолт свёрнутости у дескриптора view-секции (`IViewDescriptor.collapsed`,
// как в VS Code) на единственном его потребителе — GRAPH контейнера Source
// Control: история репозитория дороже списка изменений и нужна реже, поэтому
// секция открывается свёрнутой.
//
// Главное, что показывает сценарий, — дефолт остаётся ДЕФОЛТОМ: раскрыл
// пользователь — секция раскрыта и после перезагрузки окна. Иначе граф
// сворачивался бы на каждом старте, что хуже прежнего поведения.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-collapsed-demo-"));
    git(repoDir, "init", "-q", "-b", "main");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const appFile = join(repoDir, "app.ts");
    writeFileSync(appFile, "export const version = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: старт");
    writeFileSync(appFile, "export const version = 2;\n");
    git(repoDir, "commit", "-aqm", "fix: версия");
    // Правка на диске — CHANGES не пустует в кадре.
    writeFileSync(appFile, "export const version = 3;\n");
    return repoDir;
}

const repoDir = makeRepo();

/** Свёрнутость секции по её заголовку — то же, что видит `isViewExpanded`. */
async function expectExpanded(editor: ScenarioDriver, viewId: string, expanded: boolean): Promise<void> {
    const header = await editor.waitForNode(`#paneHeader-${viewId.replaceAll(".", "-")}`);
    const state = header.state as { expanded?: boolean; collapsible?: boolean } | undefined;
    if (state?.expanded !== expanded) {
        throw new Error(`${viewId}: expanded=${String(state?.expanded)}, ожидалось ${String(expanded)}`);
    }
    // Сворачиваемость — не то же, что свёрнутость: merged-контейнер (одна
    // видимая секция) держал бы `expanded: true` просто потому, что шеврона нет.
    if (state.collapsible !== true) throw new Error(`${viewId}: секция не сворачиваемая`);
}

export default defineScenario({
    name: "view-collapsed-default",
    title: "Дефолт свёрнутости view: GRAPH открывается свёрнутым, выбор пользователя переживает перезагрузку",
    open: [repoDir],
    cols: 100,
    rows: 30,
    // Историю в GRAPH публикует git-расширение — нужен extension host; Reload
    // Window из сценария на Windows поднимает окно без сайдбара (docs/TODO/E2E.md).
    skipOn: ["win32", "darwin"],
    userKeybindings: [
        { key: "alt+c", command: "workbench.view.scm" },
        { key: "f9", command: "workbench.action.reloadWindow" },
    ],
    async run(editor) {
        // Готовность: Explorer показал файлы (папка открыта, расширение стартует).
        await editor.waitForText((t) => t.includes("app.ts"));

        // Source Control: заголовки обеих секций на месте, но история не
        // построена — GRAPH свёрнут, и `git log` в расширении даже не запускался.
        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("GRAPH") && t.includes("app.ts"));
        await expectExpanded(editor, "workbench.scm.graph", false);
        await expectExpanded(editor, "workbench.scm.changes", true);
        const collapsed = await editor.captureFrame();
        await editor.capture("collapsed");

        // Пустое место свёрнутая секция не занимает: CHANGES забрал всю высоту
        // контейнера, а subject'ов коммитов в кадре нет вовсе.
        if (frameToText(collapsed).includes("feat: старт")) {
            throw new Error("свёрнутый GRAPH показал историю");
        }

        // Клик по шеврону GRAPH — история собирается, расширение получает
        // logSetEnabled и отдаёт лог.
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await editor.waitForText((t) => t.includes("feat: старт") && t.includes("fix: версия"));
        await expectExpanded(editor, "workbench.scm.graph", true);
        await editor.capture("expanded");

        // Перезагрузка окна: процесс уходит на перезапуск вместе с сокетом
        // инспектора — ответ на этот ввод может и не успеть прийти. Что окно
        // действительно перезапустилось, проверяет `reconnect`: он ждёт закрытия
        // прежнего сокета, а живое окно его не закроет — всё ниже иначе
        // проверяло бы ту же самую сессию, а не новую.
        await editor.sendKey("F9").catch(() => undefined);
        await editor.reconnect();
        await editor.waitForText((t) => t.includes("app.ts"), { timeoutMs: 60_000 });

        // Дефолт НЕ перебил сохранённый выбор: GRAPH всё ещё развёрнут и снова
        // полон истории.
        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("feat: старт") && t.includes("fix: версия"));
        await expectExpanded(editor, "workbench.scm.graph", true);
        await editor.capture("after-reload");
    },
});
