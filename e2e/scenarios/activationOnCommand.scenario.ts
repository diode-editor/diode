import { resolve } from "node:path";

import { ACTIVATION_LOG_KEYBINDINGS, openActivationLog, waitForActivationLine } from "../helpers/activationLog.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Событие активации `onCommand:<id>` на СТОКОВОМ расширении: команда настоящего
// charliermarsh.ruff видна в палитре, пока расширение ещё НЕ активно, и её выбор
// сначала поднимает расширение, а потом исполняется.
//
// Фикстурная папка выбрана так, чтобы у ruff'а не сработало ни одно другое его
// событие: ни `onLanguage:python`/`markdown` (открыт plaintext), ни один из шести
// `workspaceContains:` (в дереве нет ни `.py`, ни `.md`, ни pyproject.toml, ни
// ruff.toml). Единственная дверь — его команда.
//
// Демо закрывает видимую часть целиком: список палитры до активации (заголовок
// приехал из `contributes.commands`, которых расширение ещё не регистрировало —
// его код не исполнялся) и канал Extension Host после выбора, где причина
// подъёма названа `onCommand:ruff.restart`. До этой работы обе половины были
// сломаны: команда в палитре не показывалась вовсе, а исполнение по id было
// no-op'ом — реальный прокси заводит субпроцесс, то есть уже после activate().

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

        // Палитра: заголовок команды НЕактивного расширения уже в списке.
        // Ни одно событие ruff'а в этой папке не наступило — его код не
        // исполнялся, и настоящего прокси команды ещё нет.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Restart Server");
        await editor.waitForText((t) => t.includes("Restart Server"));
        await editor.capture("palette");

        // Выбор пункта: исполнение ЖДЁТ активации и только потом уходит в
        // хендлер расширения. Ассерт — причина подъёма в логе хоста.
        await editor.sendKey("Enter");
        await openActivationLog(editor);
        await waitForActivationLine(editor, 'activated extension "charliermarsh.ruff" (onCommand:ruff.restart)');
        await editor.capture("activated");
    },
});
