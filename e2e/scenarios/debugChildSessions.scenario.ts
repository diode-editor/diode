import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Child sessions, as js-debug starts them for a Node program's workers: the Debug Demo adapter's `./workers` asks
// for an `attach` session per worker with the reverse `startDebugging` request. CALL STACK shows the program with
// its workers under it; the Debug Console's title gets a select of the three consoles, Ctrl+PageDown goes to the
// next one; Stop of the program ends its workers too.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-provider");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-child-sessions",
    title: "Child sessions: the reverse startDebugging, the tree of sessions, a console per worker, Stop of the parent",
    seedUserData: userData,
    open: [folder],
    cols: 120,
    rows: 34,
    async run(editor) {
        await editor.waitForText((t) => t.includes(".diode"));
        await editor.waitForReady();

        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("Pick the program to debug") && t.includes("./workers"));
        await editor.sendText("workers");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Debug Demo: worker 2 runs as pid"));
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("View: Show Run and Debug");
        await editor.waitForText((t) => t.includes("View: Show Run and Debug"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("CALL STACK") && t.includes("worker 1") && t.includes("worker 2"));
        await editor.capture("call-stack");

        // The console opened with the session; the focus goes to its input, where Ctrl+PageDown steps the consoles.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Debug: Focus on Debug Console View");
        await editor.waitForText((t) => t.includes("Debug: Focus on Debug Console View"));
        await editor.sendKey("Enter");
        // The console's select shows the focused session, after the filter in the panel's title.
        await editor.waitForText((t) =>
            t.split("\n").some((row) => row.includes("DEBUG CONSOLE") && row.includes("⌄")),
        );
        await editor.capture("console-select");

        await editor.sendKey("Ctrl+PageDown");
        await editor.waitForText((t) => /worker 1 *⌄/u.test(t));
        await editor.capture("next-console");

        // Back to the program's console: Stop acts on the focused session, and the program's ends its workers.
        await editor.sendKey("Ctrl+PageUp");
        await editor.waitForText((t) => /Debug a picked progr\S* *⌄/u.test(t));
        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => !t.includes("PAUSED"));
        await editor.capture("stopped");
    },
});
