import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The session API of `vscode.debug` with the Debug Demo extension: its adapter sends the custom `demoReady` event,
// the extension answers with `session.customRequest("demoInfo")` and writes the result, and the frame the stop
// focused, to the Debug Console through `activeDebugConsole` (in the warning color, as VS Code shows what a debug
// extension says). Its "Break on printf" command adds a source and a function breakpoint with
// `vscode.debug.addBreakpoints`: they show in BREAKPOINTS.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-sessions",
    title: "Debugger extension and the session API: a custom event and request, the focused frame, breakpoints",
    seedUserData: userData,
    open: [folder],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes(".diode"));
        await editor.waitForReady();

        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug") && t.includes("./world"));
        await editor.sendKey("Enter");
        await editor.waitForText(
            (t) =>
                t.includes("Hello from ./hello --demo") &&
                t.includes("Debug Demo: Debug a picked program runs as pid 4242") &&
                t.includes("Debug Demo: frame 1 of thread 1"),
        );
        await editor.capture("custom-request-and-frame");
        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => t.includes("dap:terminated"));

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Debug Demo: Break on printf");
        await editor.waitForText((t) => t.includes("Debug Demo: Break on printf"));
        await editor.sendKey("Enter");
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("View: Show Run and Debug");
        await editor.waitForText((t) => t.includes("View: Show Run and Debug"));
        await editor.sendKey("Enter");
        // The title is cut to "BREAKPOINT" by its actions in the default sidebar.
        await editor.waitForText((t) => t.includes("BREAKPOINT") && t.includes("hello.c") && t.includes("printf"));
        await editor.capture("breakpoints-of-the-extension");
    },
});
