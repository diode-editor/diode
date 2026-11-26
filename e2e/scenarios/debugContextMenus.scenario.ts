import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// The context menus of the Run and Debug rows on the Debug Demo extension's adapter (it stops on entry in `main`):
// Shift+F10 on `sum` in VARIABLES opens upstream's menu, Set Value puts an input over the row and Enter sets the
// variable through the adapter; the menu of the frame in CALL STACK has the extension's own item from
// `debug/callstack/context`, which gets the frame's source and context (the extension writes them to its status
// item); the extension's `debug/toolBar` button is in the debug toolbar.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");
const sourceFile = resolve(folder, "hello.c");

async function clickText(editor: ScenarioDriver, text: string): Promise<void> {
    const cell = findTextCell(await editor.captureFrame(), text);
    if (cell === null) throw new Error(`"${text}" is not on screen`);
    await editor.click(cell.x + 1, cell.y);
}

export default defineScenario({
    name: "debug-context-menus",
    title: "Run and Debug: the rows' context menus — Set Value in place, an extension's item on a frame",
    seedUserData: userData,
    open: [folder, sourceFile],
    cols: 130,
    rows: 34,
    async run(editor) {
        await editor.waitForText((t) => t.includes("hello.c"));
        await editor.waitForReady();
        await editor.sendKey("Ctrl+k");
        await editor.sendKey("b");
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("dap:stopped") && t.includes("sum: 0"));
        await editor.waitForText((t) => t.includes("Ping the Demo"));

        await clickText(editor, "sum: 0");
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Set Value") && t.includes("Add to Watch"));
        await editor.capture("variable-menu");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("sum: 0") && !t.includes("Add to Watch"));
        await editor.sendText("42");
        await editor.capture("set-value");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("sum: 42"));
        await editor.capture("value-set");

        await clickText(editor, "main  hello.c");
        await editor.sendKey("Shift+F10");
        await editor.waitForText((t) => t.includes("Copy Call Stack") && t.includes("Show Frame in Status"));
        await editor.capture("frame-menu");
        await clickText(editor, "Show Frame in Status");
        await editor.waitForText((t) => t.includes("dbg:hello.c main"));
        await editor.capture("extension-item");
    },
});
