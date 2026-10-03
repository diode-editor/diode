import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Тот же воркспейс, что у сценария exclude-settings, но с правкой настроек —
// обе стороны слияния слоёв по ключам:
//
// - `"**/__pycache__": false` ГАСИТ дефолт: каталог вернулся в дерево и в
//   результаты поиска. Именно так у эталона снимают ненужный дефолт — значением
//   `false`, а не копированием всего списка в settings.json;
// - `"**/README.md": true` — СВОЙ шаблон рядом с дефолтными: файл из поиска
//   ушёл, но в дереве остался (`search.exclude` дерева не касается).

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "excludeSettings");

export default defineScenario({
    name: "exclude-settings-override",
    title: "files.exclude / search.exclude: погашенный дефолт и свой шаблон",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    settings: {
        "files.exclude": { "**/__pycache__": false },
        "search.exclude": { "**/README.md": true },
    },
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        // Дерево: погашенный дефолт вернул `__pycache__`, а `README.md` на месте
        // — его исключили только из поиска.
        await editor.waitForText(
            (t) => t.includes("EXPLORER") && t.includes("__pycache__") && t.includes("README.md"),
        );
        await editor.capture("tree");

        // Поиск: байткод теперь находится (гейт снят), README — нет (свой
        // шаблон). Итог тот же «2 results in 2 files», но файлы другие.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("SEARCH"));
        for (const ch of "kettleBrightSignal") {
            await editor.sendKey(ch);
        }
        await editor.waitForText(
            (t) =>
                t.includes("2 results in 2 files") &&
                t.includes("cpython-312") &&
                t.includes("app.py") &&
                !t.includes("README.md"),
        );
        await editor.capture("search");
    },
});
