import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "completionWide.txt");

const longWord = "gammaVeryLongNameThatIsQuiteDescriptiveAndEvenLongerThanForty";

function count(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

export default defineScenario({
    name: "completion-wide",
    title: "Suggest popup grows with a wide window (long labels without an ellipsis)",
    open: [repoRoot, sampleFile],
    cols: 200,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("gammaShort"));

        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("g");
        await editor.sendKey("a");
        await editor.sendKey("m");

        // The long word shows twice (line 1 + the popup row) only when the 80-column limit fits it in full.
        await editor.waitForText((t) => count(t, longWord) >= 2, { timeoutMs: 2000 });
        await editor.capture("suggest");
    },
});
