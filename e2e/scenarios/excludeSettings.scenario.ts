import { resolve } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The token is in five files, one per layer: `app.py`/`README.md` are regular; `build/generated.js` is found too, as
// upstream has no name-based list of build directories (generated ones are cut by `.gitignore`); `__pycache__/…pyc`
// is a `files.exclude` default and shows up nowhere; `bower_components/vendored.js` is a `search.exclude` default:
// visible in the tree, absent from search.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "excludeSettings");

export default defineScenario({
    name: "exclude-settings",
    title: "files.exclude / search.exclude: defaults in the tree, Quick Open and search",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    // The key DSL can't express Ctrl+Shift+F, so the command is bound to F6.
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        await editor.waitForText(
            (t) =>
                t.includes(explorerTitle(sampleDir)) &&
                t.includes("app.py") &&
                t.includes("README.md") &&
                t.includes("bower_components") &&
                t.includes("build") &&
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
                t.includes("generated.js") &&
                !t.includes("cpython") &&
                !t.includes("vendored.js"),
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
                t.includes("3 results in 3 files") &&
                t.includes("app.py") &&
                t.includes("README.md") &&
                t.includes("generated.js") &&
                !t.includes("cpython") &&
                !t.includes("vendored.js"),
        );
        await editor.capture("search");
    },
});
