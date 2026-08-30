import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Перенос строк по словам (editor.wordWrap / Alt+Z). Без переноса длинная
// строка уходит за правый край и скроллится по горизонтали; Alt+Z разворачивает
// её в несколько экранных рядов по ширине вьюпорта.
//
// Что важно на кадрах:
//  - "no-wrap": хвост длинной строки (маркер WRAP_TAIL_MARKER) за краем экрана,
//    внизу — горизонтальный скроллбар;
//  - "wrapped": строка обёрнута по границам слов, маркер виден, номера строк на
//    рядах-продолжениях погашены, горизонтальный скроллбар исчез;
//  - "unwrapped": повторный Alt+Z возвращает всё как было.

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
