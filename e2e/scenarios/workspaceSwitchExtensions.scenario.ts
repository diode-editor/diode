import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// As upstream, switching workspaces restarts the extension process: otherwise redhat.java handed jdt.ls an empty folder
// set. `workspace-probe` reads `workspace.name` once, as real extensions do.

const fixture = resolve(repoRoot, "e2e", "fixtures", "workspaceFile");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-workspace-probe");

export default defineScenario({
    name: "workspace-switch-extensions",
    title: "Open Workspace from File перезапускает расширения в новом воркспейсе",
    seedUserData: userData,
    open: [resolve(fixture, "web.code-workspace")],
    cols: 140,
    rows: 24,
    // Extension host scenario: the extension host subprocess is Linux only, like the rest.
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
