import { resolve } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// `terminal.tier` is a machine key (`scope: machine`): the project file asks for `kitty`, but the value is not applied,
// while the project's `files.exclude` lands on top of the user layer by the first frame.

const folder = resolve(repoRoot, "e2e", "fixtures", "workspaceSettings");

export default defineScenario({
    name: "workspace-settings",
    title: "Workspace settings: the project's .diode/settings.json over user settings",
    open: [folder],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes(explorerTitle(folder)) &&
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
