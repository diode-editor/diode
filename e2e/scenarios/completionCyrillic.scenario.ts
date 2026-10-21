import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Regression: an ASCII-only word prefix opened the popup with an empty prefix and flickered on every Cyrillic key.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "completion-cyrillic.txt");

const PROVERKA = "\u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430"; // "proverka"
const PRIMER = "\u043f\u0440\u0438\u043c\u0435\u0440"; // "primer"

function count(haystack: string, needle: string): number {
    return haystack.split(needle).length - 1;
}

export default defineScenario({
    name: "completion-cyrillic",
    title: "Auto-suggest filters Cyrillic words as you type",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes(PROVERKA));

        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("\u043f"); // "p"
        await editor.waitForText((t) => count(t, PROVERKA) >= 2, { timeoutMs: 2000 });
        await editor.capture("suggest");

        await editor.sendKey("\u0440"); // "r"
        await editor.sendKey("\u0438"); // "i"
        // The prefix "pri" keeps "privet", "primer" and "priyomke" but drops "proverka" (all Cyrillic).
        await editor.waitForText((t) => count(t, PRIMER) >= 2 && count(t, PROVERKA) === 1, {
            timeoutMs: 2000,
        });
        await editor.capture("narrowed");
    },
});
