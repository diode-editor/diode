import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Переключение вкладок как в VS Code: Ctrl+Tab держит hold-сессию MRU-цикла и
// показывает оверлей — замороженный MRU-список вкладок текущей группы с
// подсветкой позиции цикла (гаснет по отпусканию Ctrl); Ctrl+PgDn/PgUp циклируют
// по ВИЗУАЛЬНОМУ порядку вкладок сразу, без оверлея. Headless-инспектор не умеет
// прислать keyup одиночного модификатора (kitty event type 3), поэтому конец
// серии в демо показывает визуальный шаг Ctrl+PgDn — он завершает серию так же,
// как любой обычный свитч.

const fileA = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const fileB = resolve(repoRoot, "e2e", "fixtures", "folding.ts");
const fileC = resolve(repoRoot, "e2e", "fixtures", "wordWrap.ts");

export default defineScenario({
    name: "tab-switcher",
    title: "Ctrl+Tab: видимый MRU-список вкладок; Ctrl+PgDn/PgUp: цикл по порядку табов",
    open: [repoRoot, fileA, fileB, fileC],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText(
            (t) => t.includes("sample.ts") && t.includes("folding.ts") && t.includes("wordWrap.ts"),
        );

        // Правка в активной вкладке (wordWrap.ts): в оверлее у неё будет маркер ●.
        await editor.sendText("// touched\n");
        await editor.waitForText((t) => t.includes("●"));

        // Первый Ctrl+Tab: оверлей с MRU-списком (wordWrap → folding → sample),
        // позиция цикла — на предыдущей по MRU вкладке (folding.ts).
        await editor.sendKey("Ctrl+Tab");
        await editor.waitForText((t) => t.includes("╭"));
        await editor.capture("mru-list");

        // Ctrl удержан, второй Tab — глубже по замороженному стеку (sample.ts).
        await editor.sendKey("Ctrl+Tab");
        await editor.waitForText((t) => t.includes("sample.ts"));
        await editor.capture("mru-deeper");

        // Визуальный шаг Ctrl+PgDn завершает серию (в живом терминале то же
        // делает отпускание Ctrl): оверлей гаснет, активной становится СОСЕДНЯЯ
        // вкладка по порядку табов, MRU тут ни при чём.
        await editor.sendKey("Ctrl+PageDown");
        await editor.waitForText((t) => !t.includes("╭"));
        await editor.capture("visual-cycle");
    },
});
