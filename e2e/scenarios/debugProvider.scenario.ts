import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The Debug Demo extension contributes the `demo` debugger and reports what its configuration provider saw in the
// `dbg:` status bar item, the last event its tracker saw in the `dap:` one. Its adapter is a
// `DebugAdapterInlineImplementation`, as CodeLLDB's: it lives in the extension host, the core talks DAP to it.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-provider",
    title: "Debugger extension: F5 activates it, ${command:} and both resolutions, then a session with its own adapter",
    seedUserData: userData,
    open: [folder],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes(".diode"));
        await editor.waitForReady();

        // F5 without a keybinding of its own: `contributes.debuggers` makes `debuggersAvailable` true. The extension
        // activates on `onDebugResolve:demo`; `${command:pickProgram}` is its quick pick.
        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug") && t.includes("./world"));
        await editor.capture("command-variable");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        // The second resolution saw the substituted program in the folder of the launch; the extension's adapter
        // printed its greeting to the Debug Console and stopped on entry, which its tracker saw.
        await editor.waitForText(
            // The status bar item is clipped after the folder's first letters.
            (t) => t.includes("dbg:./world in debug-pr") && t.includes("Hello from ./world --demo"),
        );
        await editor.waitForText((t) => t.includes("dap:stopped"));
        // Ctrl+Shift+D is Ctrl+D in a legacy terminal: the palette.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("View: Show Run and Debug");
        await editor.waitForText((t) => t.includes("View: Show Run and Debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("argc: 2") && t.includes('program: "./world"'));
        await editor.capture("stopped-on-entry");
        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => t.includes("dap:terminated"));

        // A configuration the provider answers `null` for: launch.json opens.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Debug: Select and Start Debugging");
        await editor.waitForText((t) => t.includes("Debug: Select and Start Debugging"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Without a program"));
        await editor.sendText("Without");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("dbg:no program") && t.includes('"name": "Without a program"'));
        await editor.capture("launch-json-opened");
    },
});
