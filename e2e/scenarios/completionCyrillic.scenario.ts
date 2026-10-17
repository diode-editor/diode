import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Word-based suggestions in a non-Latin script: the word under the caret and the
// buffer words are Unicode, as in VS Code's default word definition. With an
// ASCII-only prefix the popup opened with an empty prefix (the whole word list)
// and the next Cyrillic letter closed and reopened it — a flicker on every key.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "completion-cyrillic.txt");

/** Number of times `needle` occurs in `haystack`. */
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

        // Empty last line, type a Cyrillic prefix letter by letter: the popup
        // opens on «п» with buffer words starting with it and narrows in place.
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
