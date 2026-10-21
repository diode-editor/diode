import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "wordWrap.ts");

export default defineScenario({
    name: "word-wrap",
    title: "Word wrap: Alt+Z wraps long lines at the viewport edge",
    open: [repoRoot, sampleFile],
    cols: 80,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("word-wrap fixture"));
        await editor.capture("no-wrap");

        await editor.sendKey("Alt+Z");
        await editor.waitForText((t) => t.includes("WRAP_TAIL_MARKER"));
        await editor.capture("wrapped");

        await editor.sendKey("Alt+Z");
        await editor.waitForText((t) => !t.includes("WRAP_TAIL_MARKER"));
        await editor.capture("unwrapped");
    },
});
