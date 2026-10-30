import { resolve } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The exclude-settings workspace with an override: `"**/__pycache__": false` disables the default (the upstream way
// to remove it), `"**/README.md": true` adds a custom pattern next to the defaults; `search.exclude` doesn't affect
// the tree.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "excludeSettings");

export default defineScenario({
    name: "exclude-settings-override",
    title: "files.exclude / search.exclude: a disabled default and a custom pattern",
    open: [sampleDir],
    cols: 110,
    rows: 26,
    settings: {
        "files.exclude": { "**/__pycache__": false },
        "search.exclude": { "**/README.md": true },
    },
    userKeybindings: [{ key: "f6", command: "workbench.view.search" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes(explorerTitle(sampleDir)) && t.includes("__pycache__") && t.includes("README.md"));
        await editor.capture("tree");

        // Same "2 results in 2 files" total, but different files.
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
