import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Extension trees are not rendered, but the extension must still activate fully. `tree-outline` is built like the
// bazel-java fork: `extends vscode.TreeItem` at module top level, and `activate()` registers the tree first.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-tree-outline");

export default defineScenario({
    name: "tree-view-noop",
    title: "Расширение с деревом живёт без панели дерева (Output + палитра)",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Extension host scenario: the CI safety net runs on Linux only (like webviewNoop).
    skipOn: ["win32"],
    userKeybindings: [
        { key: "alt+u", command: "workbench.action.output.toggleOutput" },
        { key: "alt+j", command: "workbench.action.output.show.extensions" },
        { key: "f7", command: "workbench.action.showCommands", args: "Tree Outline" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Alt+U");
        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes('дерево "treeOutline.targets" в TUI пока не рисуется'), {
            timeoutMs: 15000,
        });
        await editor.capture("output-line");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Tree Outline: List Targets"));
        await editor.capture("palette");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("targets: //app:main, //lib:greeter"), { timeoutMs: 10000 });
        await editor.capture("command-executed");
    },
});
