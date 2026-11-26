import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Inline values with the Debug Demo extension, whose inline values provider (`languages.registerInlineValuesProvider`)
// asks for `argc` and `sum` where the lines up to the stop name them: F5 stops on entry in `main` with `argc = 2`
// after its line; F10 steps over the lines, and `sum` after its lines grows as `sum += argc` runs.

const folder = resolve(repoRoot, "e2e", "fixtures", "debug-inline-values");
const helloC = resolve(folder, "hello.c");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "debug-inline-values",
    title: "Inline values: F5 shows the variables' values after the lines, F10 updates them",
    seedUserData: userData,
    open: [folder, helloC],
    cols: 120,
    rows: 30,
    async run(editor) {
        await editor.waitForText((t) => t.includes("sum += argc"));
        await editor.waitForReady();

        await editor.sendKey("F5");
        await editor.waitForText((t) => t.includes("char **argv) {  argc = 2"));
        await editor.capture("stopped-on-entry");

        // Two steps: on line 5 `sum` is still 0 after its declaration.
        await editor.sendKey("F10");
        await editor.waitForText((t) => t.includes("int sum = 0;  sum = 0"));
        await editor.sendKey("F10");
        await editor.waitForText((t) => t.includes("sum += argc;  sum = 0, argc = 2"));

        // Two more: both `sum += argc` lines ran.
        await editor.sendKey("F10");
        await editor.sendKey("F10");
        await editor.waitForText((t) => t.includes("int sum = 0;  sum = 4") && t.includes("argv[0], sum);  sum = 4"));
        await editor.capture("stepped");

        await editor.sendKey("Shift+F5");
        await editor.waitForText((t) => !t.includes("sum = 4"));
    },
});
