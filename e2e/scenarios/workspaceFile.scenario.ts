import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Файлы воркспейса над одним каталогом: два режима монорепы, у каждого свои
// закоммиченные настройки.
//
// Фикстура — каталог с `web/`, `backend/` и `generated/`. Рядом лежат
// `web.code-workspace` (прячет `backend`) и `backend.code-workspace` (прячет
// `web`), оба смотрят на `"."`. Общее для всех режимов — `.diode/settings.json`
// каталога: он прячет `generated` и действует поверх файла воркспейса (слой
// папки, как у эталона).
//
// Редактор открывается файлом `web.code-workspace` (`diode web.code-workspace`):
// в Explorer каталог `web` есть, `backend` и `generated` нет (кадр `web`).
// Палитра → «File: Open Workspace from File...» → `backend.code-workspace`: тот
// же каталог, но теперь виден `backend`, а `web` спрятан; `generated`
// по-прежнему скрыт общим файлом папки (кадр `backend`).

const fixture = resolve(repoRoot, "e2e", "fixtures", "workspaceFile");

/**
 * Каталог верхнего уровня в дереве Explorer: строка — шеврон (глиф codicon,
 * в тексте кадра — один символ) и имя, дальше пусто (вкладок в сценарии нет).
 * Файлы корня (`backend.code-workspace U`) под шаблон не попадают.
 */
function hasTopDir(screen: string, name: string): boolean {
    return new RegExp(`^\\s*\\S?\\s*${name}$`, "m").test(screen);
}

export default defineScenario({
    name: "workspace-file",
    title: "Workspace file: два .code-workspace над одним каталогом — два набора настроек",
    open: [resolve(fixture, "web.code-workspace")],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes("EXPLORER") &&
                t.includes("backend.code-workspace") &&
                hasTopDir(t, "web") &&
                !hasTopDir(t, "backend") &&
                !hasTopDir(t, "generated"),
        );
        await editor.capture("web");

        await editor.sendKey("F1");
        await editor.sendText("Open Workspace from File");
        await editor.waitForText((t) => t.includes("File: Open Workspace from File..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Enter a .code-workspace file path"));
        await editor.sendText(resolve(fixture, "backend.code-workspace"));
        await editor.sendKey("Enter");

        await editor.waitForText(
            (t) => hasTopDir(t, "backend") && !hasTopDir(t, "web") && !hasTopDir(t, "generated"),
        );
        await editor.capture("backend");
    },
});
