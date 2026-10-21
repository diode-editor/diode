import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Nesting invariant (N2): in a cramped terminal nothing overflows its container, and hit zones match what is drawn.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "narrow-terminal",
    title: "Тесный терминал: раскладка остаётся внутри границ (Н2)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.resize(30, 10);
        await editor.waitForText((t) => t.includes("File"));
        await editor.capture("narrow");
    },
});
