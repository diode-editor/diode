import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The Debug Demo extension contributes the `demo` debugger and reports what its configuration provider saw in the
// `dbg:` status bar item. It has no adapter (#1140): a start ends with the core's message about it.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-provider",
    title: "Debug configuration provider: F5 activates the debugger extension, ${command:} and both resolutions",
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
        // The second resolution saw the substituted program in the folder of the launch.
        await editor.waitForText(
            // The status bar item is clipped after the folder's first letters.
            (t) => t.includes("dbg:./world in debug-pr") && t.includes("Cannot find debug adapter for type 'demo'."),
        );
        await editor.capture("resolved");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Cannot find debug adapter"));

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
