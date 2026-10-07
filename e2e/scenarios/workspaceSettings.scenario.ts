import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Настройки воркспейса: `.diode/settings.json` открытой папки.
//
// В фикстуре проект прячет свой каталог `generated/` настройкой
// `files.exclude` — в settings.json ПРОЕКТА, пользовательские настройки
// сценария его не трогают. Первый кадр — Explorer: `main.py` и `.diode` на
// месте, `generated` нет (кадр `tree`). Значит, слой воркспейса прочитан до
// первого кадра и лёг поверх user-слоя. В том же кадре статус-бар держит
// определённый уровень терминала `legacy`, хотя файл проекта просит `kitty`.
//
// Дальше палитра → «Preferences: Open Workspace Settings (JSON)» открывает
// этот файл, а Problems (Ctrl+J) показывает подсказку эталона на
// `terminal.tier`: это ключ машины (`scope: machine`), проект его задать не
// может — значение из файла не применяется (кадр `problems`).

const folder = resolve(repoRoot, "e2e", "fixtures", "workspaceSettings");

export default defineScenario({
    name: "workspace-settings",
    title: "Workspace settings: .diode/settings.json проекта поверх пользовательских",
    open: [folder],
    cols: 110,
    rows: 26,
    async run(editor) {
        // Статус-бар показывает уровень терминала: headless-бинарь определяет
        // `legacy`. Файл проекта просит `kitty`, но это ключ машины — значение
        // не применяется, и `kitty` на первом кадре нет.
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
