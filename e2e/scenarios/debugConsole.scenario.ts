import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The Debug Console without a session: Ctrl+K Y opens the panel's console, an expression gets upstream's hint as
// its answer, Up brings it back from the history. A live session needs a debug adapter from an extension (#1139,
// #1140); the output, the evaluations and the objects of a stop are covered on the synthetic adapter by
// `repl.app.test.ts`.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "debug-console",
    title: "Debug Console: the hint without a session, the history of the input",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 30,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Ctrl+k");
        await editor.sendKey("y");
        await editor.waitForText((t) => t.includes("DEBUG CONSOLE") && t.includes("Please start a debug session"));
        await editor.capture("empty");

        await editor.sendText("total / count");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.split("\n").some((line) => line.includes("total / count")));
        await editor.sendKey("ArrowUp");
        await editor.waitForText((t) => t.split("\n").filter((line) => line.includes("total / count")).length === 2);
        await editor.capture("history");
    },
});
