import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Демо M3 (docs/TODO/ParityBacklog.md): пробел в запросе пикеров — разделитель
// термов, а не искомый символ, и палитра команд ищет fuzzy, а не подстрокой.
//
// Контрольные запросы те же, на которых снимался диагноз:
//   Ctrl+P `src other`  — раньше ноль результатов (пробел уезжал в матчер);
//   палитра `go line`   — раньше ноль результатов (подстрочный поиск).

const workspace = resolve(repoRoot, "e2e", "fixtures", "querySpaceTerms");
const notes = resolve(workspace, "notes.txt");

/**
 * Сколько раз строка встречается в кадре. Отбор по второму терму виден именно
 * числом строк списка: дерево слева показывает каталоги `lib`/`src` всегда, так
 * что «нет lib на кадре» признаком не является.
 */
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

        // ── Ctrl+P: пробел разделяет термы ──────────────────────────────────
        await editor.sendKey("Ctrl+P");
        // Ввод — только после того, как инпут пикера появился в дереве: иначе
        // текст уезжает в пустоту (палитра ещё не взяла фокус).
        await editor.waitForNode("#quickInput");

        // Один терм: оба `other.ts` в списке — отбирать ещё нечем.
        await editor.sendText("other");
        await editor.waitForText((t) => countOf(t, "other.ts") === 2);
        await editor.capture("files-one-term");

        // Добавляем второй терм через пробел: остаётся только тот `other.ts`,
        // который лежит в `src`. Раньше этот запрос не находил ничего.
        await editor.sendText(" src");
        await editor.waitForText((t) => countOf(t, "other.ts") === 1);
        await editor.capture("files-two-terms");

        await editor.sendKey("Escape");

        // ── Палитра команд: fuzzy вместо подстроки ──────────────────────────
        // F1, а не Ctrl+Shift+P: последний в key-DSL e2e не проходит.
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");

        // «Go to Line/Column...» подстрокой `go line` не содержит — до M3 палитра
        // на этом запросе отдавала пустой список.
        await editor.sendText("go line");
        await editor.waitForText((t) => t.includes("Go to Line/Column"));
        await editor.capture("palette-two-terms");
    },
});
