import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Воркспейс exclude-settings с правкой: `"**/__pycache__": false` гасит дефолт (так его снимают у эталона),
// `"**/README.md": true` — свой шаблон рядом с дефолтными; `search.exclude` дерева не касается.

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
        await editor.waitForText(
            (t) => t.includes("EXPLORER") && t.includes("__pycache__") && t.includes("README.md"),
        );
        await editor.capture("tree");

        // Итог тот же «2 results in 2 files», но файлы другие.
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
