import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Фикстура `config-update-demo` повторяет Bazel-плагин: `update("open", false)` без цели пишет в настройки
// воркспейса, тост читает значение сразу после `await`. Папка — во временном каталоге: запись ложится на диск,
// коммитнутую фикстуру пачкать нельзя.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-config-update-demo-"));
const settingsFile = join(sampleDir, ".diode", "settings.json");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-config-update");

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
            (t) => t.includes("projectview.open=false") && t.includes("After await update(): open=false"),
            { timeoutMs: 10_000 },
        );
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
