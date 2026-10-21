import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// #374: пробел в запросе пикеров — разделитель термов, палитра ищет fuzzy. Запросы — те, на которых снимался диагноз.

const workspace = resolve(repoRoot, "e2e", "fixtures", "querySpaceTerms");
const notes = resolve(workspace, "notes.txt");

/** Отбор виден числом строк списка: дерево слева показывает каталоги `lib`/`src` всегда. */
function countOf(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

export default defineScenario({
    name: "query-space-terms",
    title: "Запрос с пробелом в Ctrl+P и в палитре команд",
    open: [workspace, notes],
    cols: 110,
    rows: 26,
    async run(editor) {
        await editor.waitForText((t) => t.includes("Воркспейс демо"));

        await editor.sendKey("Ctrl+P");
        // Иначе текст уедет в пустоту: палитра ещё не взяла фокус.
        await editor.waitForNode("#quickInput");

        await editor.sendText("other");
        await editor.waitForText((t) => countOf(t, "other.ts") === 2);
        await editor.capture("files-one-term");

        await editor.sendText(" src");
        await editor.waitForText((t) => countOf(t, "other.ts") === 1);
        await editor.capture("files-two-terms");

        await editor.sendKey("Escape");

        // F1, а не Ctrl+Shift+P: последний в key-DSL e2e не проходит.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");

        await editor.sendText("go line");
        await editor.waitForText((t) => t.includes("Go to Line/Column"));
        await editor.capture("palette-two-terms");
    },
});
