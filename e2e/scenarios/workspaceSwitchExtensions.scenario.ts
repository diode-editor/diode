import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Как у эталона, смена воркспейса перезапускает процесс расширений: иначе redhat.java отдавал jdt.ls пустой
// набор папок. `workspace-probe` читает `workspace.name` один раз, как настоящие расширения.

const fixture = resolve(repoRoot, "e2e", "fixtures", "workspaceFile");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-workspace-probe");

export default defineScenario({
    name: "workspace-switch-extensions",
    title: "Open Workspace from File перезапускает расширения в новом воркспейсе",
    seedUserData: userData,
    open: [resolve(fixture, "web.code-workspace")],
    cols: 140,
    rows: 24,
    // Extension-host сценарий: субпроцесс расширений — Linux only, как остальные.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("web (Workspace)"), {
            timeoutMs: 20_000,
        });
        await editor.capture("web");

        await editor.sendKey("F1");
        await editor.sendText("Open Workspace from File");
        await editor.waitForText((t) => t.includes("File: Open Workspace from File..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Enter a .code-workspace file path"));
        await editor.sendText(resolve(fixture, "backend.code-workspace"));
        await editor.sendKey("Enter");

        await editor.waitForText(
            (t) =>
                t.includes("backend (Workspace)") &&
                !t.includes("web (Workspace)"),
            { timeoutMs: 20_000 },
        );
        await editor.capture("backend");
    },
});
