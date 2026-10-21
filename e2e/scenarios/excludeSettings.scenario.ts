import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Токен лежит в четырёх файлах, по слою на каждый: `app.py`/`README.md` — свои; `__pycache__/…pyc` — дефолт
// `files.exclude`, нет нигде; `out/bundle.js` — дефолт `search.exclude`: в дереве виден, в поиске нет (эталон:
// сборку открывают, но в поиске она дубль исходника).

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "excludeSettings");

export default defineScenario({
    name: "exclude-settings",
    title: "files.exclude / search.exclude: дефолты в дереве, Quick Open и поиске",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    // Ctrl+Shift+F в key-DSL не выражается — команда на F6.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes("EXPLORER") &&
                t.includes("app.py") &&
                t.includes("README.md") &&
                t.includes("out") &&
                !t.includes("__pycache__"),
        );
        await editor.capture("tree");

        // Quick Open режет по обоим наборам.
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
