import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `web.code-workspace` прячет `backend`, `backend.code-workspace` — `web`; `.diode/settings.json` каталога прячет
// `generated` и действует поверх файла воркспейса (слой папки, как у эталона).

const fixture = resolve(repoRoot, "e2e", "fixtures", "workspaceFile");

/** Шеврон (один символ в тексте кадра) и имя, дальше пусто; файлы корня под шаблон не попадают. */
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
