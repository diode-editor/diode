import { resolve } from "node:path";

import { ACTIVATION_LOG_KEYBINDINGS, openActivationLog, waitForActivationLine } from "../helpers/activationLog.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `onCommand:<id>` на стоковом ruff: команда видна в палитре до активации, а выбор сначала поднимает расширение.
// В фикстуре нет поводов для других событий ruff'а (ни `.py`/`.md`, ни pyproject.toml/ruff.toml) — единственная дверь — команда.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "activationOnCommand");
const notesFile = resolve(sampleDir, "notes.txt");

export default defineScenario({
    name: "activation-on-command",
    title: "Активация по onCommand: команда стокового ruff в палитре до его подъёма",
    open: [sampleDir, notesFile],
    installVsix: ["charliermarsh.ruff"],
    network: true,
    cols: 120,
    rows: 24,
    userKeybindings: ACTIVATION_LOG_KEYBINDINGS,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Единственная дверь"));

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Restart Server");
        await editor.waitForText((t) => t.includes("Restart Server"));
        await editor.capture("palette");

        await editor.sendKey("Enter");
        await openActivationLog(editor);
        await waitForActivationLine(editor, 'activated extension "charliermarsh.ruff" (onCommand:ruff.restart)');
        await editor.capture("activated");
    },
});
