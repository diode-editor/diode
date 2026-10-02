import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Локализация манифеста расширения на СТОКОВОМ расширении из магазина: ставится
// настоящий `redhat.java`, и его команды в палитре обязаны выглядеть
// по-человечески — «Java: Switch to Standard Mode», а не `%java.server.mode.switch%`.
// Ровно это пользователь и видел («в java странные имена команд»): у 32 из 36
// записей `contributes.commands` заголовок — nls-ключ, а рядом лежит
// `package.nls.json` на 33 ключа, который никто не читал.
//
// На кадре видны обе половины узла:
//   1. резолв `%key%` → строка из `package.nls.json`;
//   2. `category: "Java"` манифеста → префикс подписи, как в VS Code. Команды
//      БЕЗ категории (`java.open.serverStdoutLog` и `…StderrLog`) префикса не
//      получают — поэтому запрос в кадре `Java: `, а не `java`.
//
// Расширение при этом НЕ активируется: java-файла в воркспейсе нет, jdt.ls не
// поднимается. Заголовки приезжают из заглушек `onCommand:`, заведённых при
// регистрации манифеста, — то есть сценарий проверяет именно загрузку манифеста
// и стоит минуты, а не четверти часа (полный путь jdt.ls закрывает `java-lsp`).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "extensionNls.txt");

export default defineScenario({
    name: "extension-nls",
    title: "NLS манифеста: человеческие имена команд стокового redhat.java в палитре",
    open: [sampleFile],
    installVsix: ["redhat.java"],
    network: true,
    // Без этого расширение спрашивает согласие на телеметрию тостом поверх кадра
    // (как в java-lsp). Активации тут нет, но настройка дешевле, чем флак.
    settings: { "redhat.telemetry.enabled": false },
    // Внутрь кейса попадает закачка 139-МБ платформенного vsix.
    timeoutMs: 600_000,
    cols: 110,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Ни строчки Java"), { timeoutMs: 60_000 });

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput", { timeoutMs: 30_000 });
        // Палитра фильтрует подстрокой (fuzzy — отдельный узел), поэтому запрос
        // буквальный. Он же проверяет склейку: `Java: ` есть только в подписи,
        // собранной из category и title, — в самом заголовке такого нет.
        await editor.sendText("Java: ");

        const frame = await editor.waitForText((t) => t.includes("Java: Switch to Standard Mode"), {
            timeoutMs: 60_000,
        });
        // Ни одного нерезолвленного ключа на кадре: до этой работы здесь стояли
        // ровно они.
        if (frameToText(frame).includes("%java.")) {
            throw new Error("extension-nls: в палитре остался nls-ключ вместо заголовка");
        }
        await editor.capture("command-palette");
    },
});
