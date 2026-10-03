import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Слой exclude-настроек на дефолтах: три потребителя одного набора шаблонов.
//
// В фикстуре один и тот же токен лежит в четырёх файлах, и каждый из них
// отвечает за свой слой:
//
// - `app.py`, `README.md` — своё, видно и ищется;
// - `__pycache__/app.cpython-312.pyc` — дефолт `files.exclude`: нет НИГДЕ (ни в
//   дереве, ни в Quick Open, ни в результатах поиска). Это и был симптом
//   заявки: в `files.watcherExclude` каталог уже был, а дерево и поиск его
//   показывали;
// - `out/bundle.js` — дефолт `search.exclude`: в дереве ВИДЕН, в поиске нет.
//   Разделение эталонное: результат сборки открывают, но в результатах поиска
//   он дубликат собственного исходника.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "excludeSettings");

export default defineScenario({
    name: "exclude-settings",
    title: "files.exclude / search.exclude: дефолты в дереве, Quick Open и поиске",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    // Настоящий бинд поиска — Ctrl+Shift+F, в key-DSL он не выражается (нужен
    // kitty/csi-u терминал), поэтому команда повешена на F6, как в сценарии
    // searchInFiles.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        // Дерево: `app.py`, `README.md` и каталог `out` на месте, `__pycache__`
        // скрыт дефолтом `files.exclude`.
        await editor.waitForText(
            (t) =>
                t.includes("EXPLORER") &&
                t.includes("app.py") &&
                t.includes("README.md") &&
                t.includes("out") &&
                !t.includes("__pycache__"),
        );
        await editor.capture("tree");

        // Quick Open: индекс файлов режет по ОБОИМ наборам, поэтому ни байткода,
        // ни бандла в списке нет — только свои два файла.
        await editor.sendKey("Ctrl+P");
        await editor.waitForText(
            (t) =>
                t.includes("Go to File") &&
                t.includes("app.py") &&
                t.includes("README.md") &&
                !t.includes("cpython") &&
                !t.includes("bundle.js"),
        );
        await editor.capture("quick-open");
        await editor.sendKey("Escape");

        // Поиск по содержимому: токен найден только в своих двух файлах —
        // байткод вырезан `files.exclude`, бандл `search.exclude`.
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("SEARCH"));
        for (const ch of "kettleBrightSignal") {
            await editor.sendKey(ch);
        }
        await editor.waitForText(
            (t) =>
                t.includes("2 results in 2 files") &&
                t.includes("app.py") &&
                t.includes("README.md") &&
                !t.includes("cpython") &&
                !t.includes("bundle.js"),
        );
        await editor.capture("search");
    },
});
