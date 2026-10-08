import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `WorkspaceConfiguration.update` из расширения. Фикстура `config-update-demo`
// повторяет Bazel-плагин: держит в статус-баре `get("open")` своей настройки
// и по команде гасит её `update("open", false)` без цели — в настройки
// воркспейса. Кадры: значение по умолчанию → после записи статус-бар и тост
// расширения (читает сразу после `await`) видят `false`, а файл
// `.diode/settings.json` папки лёг на диск → он же через «Preferences: Open
// Workspace Settings (JSON)» → запись незарегистрированного ключа отклонена
// текстом эталона, который расширение показало само.
//
// Папка — во временном каталоге: запись ложится НА ДИСК, коммитнутую фикстуру
// пачкать нельзя (паттерн bulkWorkspaceEdit.scenario.ts).

const sampleDir = mkdtempSync(join(tmpdir(), "diode-config-update-demo-"));
const settingsFile = join(sampleDir, ".diode", "settings.json");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-config-update");

/** Исполняет команду через палитру (F1 → заголовок → Enter). */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "configuration-update",
    title: "WorkspaceConfiguration.update: расширение пишет свою настройку в .diode/settings.json",
    seedUserData: userData,
    open: [sampleDir],
    cols: 120,
    rows: 26,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(join(sampleDir, "BUILD"), "# демо-воркспейс\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("projectview.open=true") && t.includes("BUILD"), {
            timeoutMs: 20_000,
        });
        await editor.capture("default");

        await runCommand(editor, "Config Update Demo: Do Not Open Project View Again");
        await editor.waitForText(
            // Статус-бар перерисован по onDidChangeConfiguration — без перезапуска.
            (t) => t.includes("projectview.open=false") && t.includes("After await update(): open=false"),
            { timeoutMs: 10_000 },
        );
        // Главная проверка: файл настроек воркспейса на диске.
        await waitUntil(
            () => Promise.resolve(readSettings()),
            (text) => text.includes('"configUpdateDemo.projectview.open": false'),
            { describe: ".diode/settings.json с записанным ключом", timeoutMs: 5000, intervalMs: 100 },
        );
        await editor.capture("written");

        await runCommand(editor, "Preferences: Open Workspace Settings (JSON)");
        await editor.waitForText((t) => t.includes('"configUpdateDemo.projectview.open": false'));
        await editor.capture("settings-file");

        await runCommand(editor, "Config Update Demo: Write Unregistered Key");
        await editor.waitForText((t) => t.includes("is not a registered configuration"), { timeoutMs: 10_000 });
        await editor.capture("rejected");
    },
});

function readSettings(): string {
    try {
        return readFileSync(settingsFile, "utf8");
    } catch {
        return "";
    }
}
