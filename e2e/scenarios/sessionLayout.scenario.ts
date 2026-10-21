import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// A screenshot spans one session and can't show the restart; the round-trip is covered by StateService.test.ts,
// WorkbenchStateController.test.ts and AppController.StatePersistence.test.ts.

const fileA = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const fileB = resolve(repoRoot, "e2e", "fixtures", "folding.ts");

export default defineScenario({
    name: "session-layout",
    title: "Persisted session layout: open tabs + bottom panel",
    open: [repoRoot, fileA, fileB],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("sample.ts") && t.includes("folding.ts"));
        await editor.capture("tabs");

        await editor.sendKey("Ctrl+J");
        await editor.waitForText((t) => t.includes("PROBLEMS"));
        await editor.capture("panel-open");
    },
});
