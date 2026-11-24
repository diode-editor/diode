import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Run and Debug without a session: the welcome with the full-width button and a watch expression that has no
// frame to be evaluated in. A live session needs a debug adapter from an extension (#1139, #1140); the views of a
// stop are covered on the synthetic adapter by `debugViewlet.app.test.ts`.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "run-and-debug",
    title: "Run and Debug: the welcome without a session, a watch expression that is not available",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 30,
    // The Add Expression button sits in the WATCH title; a key reaches it without aiming the mouse.
    userKeybindings: [{ key: "ctrl+alt+w", command: "workbench.debug.viewlet.action.addWatchExpression" }],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Ctrl+k");
        await editor.sendKey("b");
        await editor.waitForText((t) => t.includes("RUN AND DEBUG") && t.includes("To customize Run and Debug"));
        await editor.capture("welcome");

        await editor.sendKey("Ctrl+Alt+w");
        await editor.waitForText((t) => t.includes("Expression to watch"));
        await editor.sendText("total / n");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("total / n: not available"));
        await editor.capture("watch");
    },
});
