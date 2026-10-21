import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";
import { ACTIVATION_LOG_KEYBINDINGS, openActivationLog, waitForActivationLine } from "../helpers/activationLog.ts";

// `workspaceContains:<glob>` on stock ruff: of its events only the recursive `**/pyproject.toml` can match, and
// the matching file sits one level deeper (`nested/`). The activation reason in the log is the assertion itself:
// without it, this activation is indistinguishable from one triggered by another event.

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
