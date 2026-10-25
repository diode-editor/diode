import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// An extension's tree view (`window.createTreeView`) is drawn in its contributed section. `tree-outline` is built
// like the bazel-java fork: `extends vscode.TreeItem` at module top level, the tree registered first in `activate()`.
// Packages start Expanded, a target's command shows a toast, "Add Target" fires `onDidChangeTreeData`.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-tree-outline");

async function clickText(editor: ScenarioDriver, needle: string): Promise<void> {
    const frame = await editor.waitForText((t) => t.includes(needle));
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen`);
    await editor.click(cell.x, cell.y);
}

export default defineScenario({
    name: "extension-tree-view",
    title: "Extension tree view: rows with icons and descriptions, a row's command, refresh from the extension",
    seedUserData: userData,
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    // Extension host scenario: the CI safety net runs on Linux only (like webviewNoop).
    skipOn: ["win32"],
    userKeybindings: [{ key: "f7", command: "workbench.action.showCommands", args: "Tree Outline: Add" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // A foreign section in Explorer starts collapsed, as upstream.
        await clickText(editor, "RUN TARGETS");
        await editor.waitForText((t) => t.includes("//app 2 targets") && t.includes("server"), { timeoutMs: 15000 });
        await editor.capture("tree");

        await clickText(editor, "main");
        await editor.waitForText((t) => t.includes("Running main"), { timeoutMs: 10000 });
        await editor.capture("command-toast");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Tree Outline: Add Target"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("//tools 1 targets") && t.includes("lint"), { timeoutMs: 10000 });
        await editor.capture("refreshed");
    },
});
