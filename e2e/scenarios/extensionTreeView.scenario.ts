import { resolve } from "node:path";

import { CODICON_GLYPHS } from "../../src/vs/base/common/codicons.generated.ts";
import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// An extension's tree view (`window.createTreeView`) is drawn in its contributed section. `tree-outline` is built
// like the bazel-java fork: `extends vscode.TreeItem` at module top level, the tree registered first in `activate()`.
// Packages start Expanded, a target's command shows a toast, "Add Target" fires `onDidChangeTreeData`.
// `view/item/context`: a right click shows the row's items by its `contextValue`, a target row under the cursor
// shows the inline Edit glyph; both write the element they got to the "Tree Outline" output.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-tree-outline");
/** The inline item's `$(edit)`, from the same table the menu renders. */
const EDIT_GLYPH = CODICON_GLYPHS.edit;

async function clickText(editor: ScenarioDriver, needle: string): Promise<void> {
    const frame = await editor.waitForText((t) => t.includes(needle));
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen`);
    await editor.click(cell.x, cell.y);
}

async function rightClickText(editor: ScenarioDriver, needle: string): Promise<void> {
    const frame = await editor.waitForText((t) => t.includes(needle));
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen`);
    await editor.sendMouse({ action: "press", button: "right", x: cell.x, y: cell.y });
    await editor.sendMouse({ action: "release", button: "right", x: cell.x, y: cell.y });
}

export default defineScenario({
    name: "extension-tree-view",
    title: "Extension tree view: rows with icons and descriptions, a row's command, its menus, refresh from the extension",
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

        // The cursor row is "main": its inline Edit glyph is on the right of the row.
        await editor.waitForText((t) => t.includes(EDIT_GLYPH));
        await editor.capture("inline-edit");
        await clickText(editor, EDIT_GLYPH);
        await editor.waitForText((t) => t.includes("edit: main (same)"), { timeoutMs: 10000 });
        await editor.capture("inline-edit-output");

        await rightClickText(editor, "server");
        await editor.waitForText((t) => t.includes("Inspect Target") && t.includes("Copy Name"));
        await editor.capture("target-menu");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("inspect: server (same)"), { timeoutMs: 10000 });

        await rightClickText(editor, "//app");
        await editor.waitForText((t) => t.includes("Build Package") && !t.includes("Inspect Target"));
        await editor.capture("package-menu");
        await editor.sendKey("Escape");

        await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Tree Outline: Add Target"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("//tools 1 targets") && t.includes("lint"), { timeoutMs: 10000 });
        await editor.capture("refreshed");
    },
});
