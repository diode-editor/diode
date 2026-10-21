import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";
import { ACTIVATION_LOG_KEYBINDINGS, openActivationLog, waitForActivationLine } from "../helpers/activationLog.ts";

// `workspaceContains:<glob>` на стоковом ruff: из его событий подойти может только рекурсивное
// `**/pyproject.toml`, и файл под него лежит на уровень глубже (`nested/`). Причина подъёма в логе — и есть
// ассерт: без неё активацию не отличить от активации по другому событию.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "activationWorkspaceContains");
const notesFile = resolve(sampleDir, "notes.txt");

export default defineScenario({
    name: "activation-workspace-contains",
    title: "Активация по workspaceContains: стоковый ruff поднят рекурсивным глобом",
    open: [sampleDir, notesFile],
    installVsix: ["charliermarsh.ruff"],
    network: true,
    cols: 120,
    rows: 24,
    userKeybindings: ACTIVATION_LOG_KEYBINDINGS,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Заметки проекта"));
        await editor.capture("workspace");

        await openActivationLog(editor);
        await waitForActivationLine(
            editor,
            'activated extension "charliermarsh.ruff" (workspaceContains:**/pyproject.toml)',
        );
        await editor.capture("activated");
    },
});
