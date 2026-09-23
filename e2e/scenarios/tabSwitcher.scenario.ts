import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Переключение вкладок как в VS Code: Ctrl+Tab держит hold-сессию MRU-цикла и
// показывает оверлей — замороженный MRU-список вкладок текущей группы с
// подсветкой позиции цикла (гаснет по отпусканию Ctrl); Ctrl+PgDn/PgUp циклируют
// по ВИЗУАЛЬНОМУ порядку вкладок сразу, без оверлея. Пока список виден, шагать по
// нему можно и стрелками: Ctrl+Вниз = тот же шаг, что Tab, Ctrl+Вверх = что
// Shift+Tab. Headless-инспектор не умеет прислать keyup одиночного модификатора
// (kitty event type 3), поэтому конец серии в демо показывает визуальный шаг
// Ctrl+PgDn — он завершает серию так же, как любой обычный свитч.

const fileA = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const fileB = resolve(repoRoot, "e2e", "fixtures", "folding.ts");
const fileC = resolve(repoRoot, "e2e", "fixtures", "wordWrap.ts");

export default defineScenario({
    name: "tab-switcher",
    title: "Ctrl+Tab: видимый MRU-список вкладок и шаг по нему стрелками; Ctrl+PgDn/PgUp: цикл по порядку табов",
    open: [repoRoot, fileA, fileB, fileC],
    cols: 120,
    rows: 32,
    async run(editor) {
        // Под оверлеем видно содержимое вкладки, которую он подсвечивает, — по
        // нему и ждём шаг серии (сами имена в кадре есть всегда: они и в полосе
        // вкладок, и в самом списке). Маркеры взяты с ПЕРВОЙ строки файлов: она
        // выше оверлея, который начинается с ~10% высоты экрана.
        const underOverlay = { "folding.ts": "folding-chevron hover", "sample.ts": "used by SEA e2e" } as const;
        const stepTo = async (file: keyof typeof underOverlay): Promise<void> => {
            await editor.waitForText((t) => t.includes("╭") && t.includes(underOverlay[file]));
        };

        await editor.waitForText(
            (t) => t.includes("sample.ts") && t.includes("folding.ts") && t.includes("wordWrap.ts"),
        );

        // Правка в активной вкладке (wordWrap.ts): в оверлее у неё будет маркер ●.
        await editor.sendText("// touched\n");
        await editor.waitForText((t) => t.includes("●"));

        // Первый Ctrl+Tab: оверлей с MRU-списком (wordWrap → folding → sample),
        // позиция цикла — на предыдущей по MRU вкладке (folding.ts).
        await editor.sendKey("Ctrl+Tab");
        await stepTo("folding.ts");
        await editor.capture("mru-list");

        // Ctrl удержан, второй Tab — глубже по замороженному стеку (sample.ts).
        await editor.sendKey("Ctrl+Tab");
        await stepTo("sample.ts");
        await editor.capture("mru-deeper");

        // Ctrl удержан, стрелка Вверх — шаг НАЗАД по тому же списку (как
        // Shift+Tab): список не гаснет, подсветка вернулась на folding.ts, и
        // под оверлеем снова он.
        await editor.sendKey("Ctrl+ArrowUp");
        await stepTo("folding.ts");
        await editor.capture("arrow-up");

        // Стрелка Вниз — шаг ВГЛУБЬ (как Tab): подсветка снова на sample.ts.
        await editor.sendKey("Ctrl+ArrowDown");
        await stepTo("sample.ts");
        await editor.capture("arrow-down");

        // Визуальный шаг Ctrl+PgDn завершает серию (в живом терминале то же
        // делает отпускание Ctrl): оверлей гаснет, активной становится СОСЕДНЯЯ
        // вкладка по порядку табов, MRU тут ни при чём.
        await editor.sendKey("Ctrl+PageDown");
        await editor.waitForText((t) => !t.includes("╭"));
        await editor.capture("visual-cycle");
    },
});
