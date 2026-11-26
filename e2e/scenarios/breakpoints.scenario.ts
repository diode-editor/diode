import { resolve } from "node:path";

import { findTextCell } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// BREAKPOINTS without a session: a function breakpoint added from the view's title, Space disables it (its icon
// turns grey), Space enables it again, Delete removes it. A live session needs a debug adapter from an extension
// (#1139, #1140); CALL STACK and the breakpoints of a stop are covered on the synthetic adapter by
// `callStackView.app.test.ts` and `breakpointsView.app.test.ts`.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "breakpoints",
    title: "Run and Debug: a function breakpoint in BREAKPOINTS, Space disables it, Delete removes it",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 30,
    // Add Function Breakpoint sits in the BREAKPOINTS title; a key reaches it without aiming the mouse.
    userKeybindings: [{ key: "ctrl+alt+b", command: "workbench.debug.viewlet.action.addFunctionBreakpointAction" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Ctrl+k");
        await editor.sendKey("b");
        // The title is cut to "BREAKPOINT" by its actions in the default sidebar.
        await editor.waitForText((t) => t.includes("BREAKPOINT"));

        await editor.sendKey("Ctrl+Alt+b");
        await editor.waitForText((t) => t.includes("Function to break on"));
        await editor.sendText("greet");
        await editor.sendKey("Enter");
        await editor.waitForText(
            (t) => t.includes("[✓]") && t.includes("greet") && !t.includes("Function to break on"),
        );
        await editor.capture("function-breakpoint");

        // A click on the name (not on the checkbox) puts the cursor on the row.
        const row = findTextCell(await editor.captureFrame(), "[✓]");
        if (row === null) throw new Error("the breakpoint row disappeared");
        await editor.click(row.x + 7, row.y);
        await editor.sendKey(" ");
        await editor.waitForText((t) => t.includes("[ ]"));
        await editor.capture("disabled");

        await editor.sendKey(" ");
        await editor.waitForText((t) => t.includes("[✓]"));
        await editor.sendKey("Delete");
        await editor.waitForText((t) => !t.includes("[✓]") && !t.includes("[ ]"));
        await editor.capture("removed");
    },
});
