import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// The palette lists Show Type Hierarchy for every language. Plain text has no provider: instead of silence the
// command answers with the same `No results` toast as an empty caret does.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-hierarchy-no-provider-"));
const txtFile = join(sampleDir, "notes.txt");

export default defineScenario({
    name: "hierarchy-no-provider",
    title: "Show Type Hierarchy in a language without a provider: the `No results` toast",
    open: [sampleDir, txtFile],
    cols: 90,
    rows: 20,
    async prepare() {
        writeFileSync(txtFile, "plain notes\n");
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("plain notes"), { timeoutMs: 20_000 });
        await editor.waitForReady();

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Show Type Hierarchy");
        await editor.waitForText((t) => t.includes("Show Type Hierarchy"));
        await editor.capture("the command is in the palette for plain text");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Information") && t.includes("No results"));
        await editor.capture("No results instead of silence");
    },
});
