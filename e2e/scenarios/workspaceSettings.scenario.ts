import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `terminal.tier` — ключ машины (`scope: machine`): файл проекта просит `kitty`, но значение не применяется,
// а `files.exclude` проекта ложится поверх user-слоя уже к первому кадру.

const folder = resolve(repoRoot, "e2e", "fixtures", "workspaceSettings");

export default defineScenario({
    name: "workspace-settings",
    title: "Workspace settings: .diode/settings.json проекта поверх пользовательских",
    open: [folder],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes("EXPLORER") &&
                t.includes("main.py") &&
                t.includes(".diode") &&
                !t.includes("generated") &&
                t.includes("legacy") &&
                !t.includes("kitty"),
        );
        await editor.capture("tree");

        await editor.sendKey("F1");
        await editor.sendText("Open Workspace Settings (JSON)");
        await editor.waitForText((t) => t.includes("Preferences: Open Workspace Settings (JSON)"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('"terminal.tier": "kitty"'));

        await editor.sendKey("Ctrl+J");
        await editor.waitForText((t) => t.includes("This setting can only be applied in user settings"));
        await editor.capture("problems");
    },
});
