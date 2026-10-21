import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The token is in four files, one per layer: `app.py`/`README.md` are regular; `__pycache__/…pyc` is a
// `files.exclude` default and shows up nowhere; `out/bundle.js` is a `search.exclude` default: visible in the tree,
// absent from search (upstream: build output gets opened, but in search it duplicates the source).

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "excludeSettings");

export default defineScenario({
    name: "exclude-settings",
    title: "files.exclude / search.exclude: дефолты в дереве, Quick Open и поиске",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    // The key DSL can't express Ctrl+Shift+F, so the command is bound to F6.
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

        // Quick Open filters by both sets.
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
