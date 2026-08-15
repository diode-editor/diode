import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Output-панель: вкладка OUTPUT в нижней Panel над настоящими каналами логов —
// bootstrap/configuration/extensions пишутся ещё до подъёма TUI, так что контент
// непустой с первого кадра. Содержимое — обычный read-only редактор с языком
// `log`, как в VS Code: гуттер, подсветка уровней, выделение и Ctrl+F.
//
// Канал переключаем командой `workbench.action.output.show.<id>` — это тот же
// путь, которым ходит выбор в селекторе: пункты его списка и есть эти команды
// (submenu `switchOutput`, помеченное `isSelection`). Драйвер сценариев не умеет
// мышь, а Tab в read-only редакторе фокус на шапку не уводит, поэтому раскрытие
// списка проверяется юнит-тестами `selectBoxElement.test.ts`.
//
// Клавиши — через user-кейбинды: палитра возвращает фокус меню-бару, через
// который её открыли. Букву O не берём: `ESC O` — префикс SS3-последовательностей
// (`ESC O P` = F1), терминал разбирает его как спецклавишу.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "output",
    title: "Output: лог подсистемы в нижней панели",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    userKeybindings: [
        { key: "alt+u", command: "workbench.action.output.toggleOutput" },
        { key: "alt+j", command: "workbench.action.output.show.extensions" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+U");

        // Вкладка OUTPUT встала между PROBLEMS и TERMINAL, в шапке — селектор с
        // активным каналом, в теле — живой лог с уровнем в скобках (форма, под
        // которую заточена стоковая грамматика log).
        await editor.waitForText((t) => t.includes("OUTPUT"));
        await editor.waitForText((t) => t.includes("[info] diode starting"));
        await editor.waitForText((t) => t.includes("Bootstrap"));
        await editor.capture("panel");

        // Переключение подсистемы: и содержимое, и подпись селектора идут за ним.
        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes("Extensions") && !t.includes("diode starting"));
        await editor.capture("channel-switched");

        // BUG-1 из ревью: после смены канала фокус оставался ни на чём и
        // клавиатура переставала доходить куда-либо. Проверяем следствием —
        // курсор обязан двигаться по логу.
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.waitForText((t) => t.includes("Ln 1, Col 1"));
    },
});
