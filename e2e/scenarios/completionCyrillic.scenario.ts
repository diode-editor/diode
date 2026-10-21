import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Regression: an ASCII-only word prefix opened the popup with an empty prefix and flickered on every Cyrillic key.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "completion-cyrillic.txt");

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
        await editor.waitForText((t) => t.includes("проверка"));

        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("п");
        await editor.waitForText((t) => count(t, "проверка") >= 2, { timeoutMs: 2000 });
        await editor.capture("suggest");

        await editor.sendKey("р");
        await editor.sendKey("и");
        // «при» keeps «привет», «пример» and «приёмке», drops «проверка».
        await editor.waitForText((t) => count(t, "пример") >= 2 && count(t, "проверка") === 1, {
            timeoutMs: 2000,
        });
        await editor.capture("narrowed");
    },
});
