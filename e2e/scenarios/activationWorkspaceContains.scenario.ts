import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";
import { ACTIVATION_LOG_KEYBINDINGS, openActivationLog, waitForActivationLine } from "../helpers/activationLog.ts";

// Событие активации `workspaceContains:<glob>` на СТОКОВОМ расширении: настоящий
// charliermarsh.ruff ставится ИЗ МАГАЗИНА и поднимается, хотя ни одного
// python-файла в воркспейсе не открыто.
//
// Демо закрывает видимую часть, которую юниты не видят: повод активации считается
// по настоящему дереву настоящей папки воркспейса. В фикстуре нет ни `.py`, ни
// `.md`, ни корневого `pyproject.toml` — из восьми событий ruff'а подойти может
// ровно одно, рекурсивное `workspaceContains:**/pyproject.toml`, и файл под него
// лежит на уровень глубже (`nested/`). До этой работы расширение молчало бы
// навсегда: матчинг событий был точным сравнением строк.
//
// Наблюдаемый результат — канал Extension Host, где хост пишет расширение и
// ПРИЧИНУ его подъёма. Причина в строке и есть ассерт: «активировалось» без неё
// не отличить от активации по какому-то другому событию.

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
    // Extension-host сценарии гоняют subprocess — Linux only, как остальные.
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
