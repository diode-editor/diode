import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// Stock Todo Tree from the marketplace: rg from `env.appRoot` scans the folder, the TODOS container lists
// the tags, a click on a tag puts the cursor on its line, an edit of the open file adds a node without a save.

const sampleDir = resolve(repoRoot, "e2e", "fixtures", "todoTreeSample");
const configFile = resolve(sampleDir, "src", "config.ts");

async function clickText(editor: ScenarioDriver, needle: string): Promise<void> {
    const frame = await editor.waitForText((t) => t.includes(needle), { timeoutMs: 30_000 });
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`"${needle}" is not on screen`);
    await editor.click(cell.x, cell.y);
}

export default defineScenario({
    name: "todo-tree",
    title: "Todo Tree from the marketplace: the TODOS tree, a jump to the tag's line, an edit adds a node",
    open: [sampleDir, configFile],
    installVsix: ["Gruntfuggly.todo-tree"],
    network: true,
    cols: 110,
    rows: 24,
    // Extension host scenarios run a subprocess — Linux only.
    skipOn: ["win32", "darwin"],
    // Counts make tree labels unique: "config.ts" alone is also the editor tab.
    settings: { "todo-tree.general.statusBar": "total", "todo-tree.tree.showCountsInTree": true },
    userKeybindings: [{ key: "f7", command: "workbench.view.extension.todo-tree-container" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("fixed port"));
        await editor.waitForReady();

        await editor.sendKey("F7");
        // Nodes start collapsed, as in VS Code; compact folders join the workspace with its only folder.
        await clickText(editor, "todoTreeSample/src 3");
        await clickText(editor, "config.ts 2");
        await clickText(editor, "util.py 1");
        await editor.waitForText((t) => t.includes("FIXME : fixed port") && t.includes("BUG : empty list"));
        await editor.capture("tree");

        await clickText(editor, "FIXME : fixed port");
        await editor.waitForText((t) => t.includes("Ln 4, Col 1"));
        await editor.capture("jump-to-line");

        // A new tag at the end of the open file, unsaved.
        await editor.sendKey("Ctrl+End");
        await editor.sendText("// TODO: port from env");
        await editor.waitForText((t) => t.includes("TODO : port from env"), { timeoutMs: 20_000 });
        await editor.capture("edit-adds-node");
    },
});
