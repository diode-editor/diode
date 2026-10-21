import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Headless-инспектор не шлёт keyup одиночного модификатора (kitty event type 3) — конец серии показывает
// Ctrl+PgDn: он завершает её так же, как отпускание Ctrl.

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
        // Шаг серии ждём по содержимому под оверлеем (имена в кадре есть всегда); маркеры — с первой строки файлов,
        // она выше оверлея (~10% высоты экрана).
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

        await editor.sendKey("Ctrl+Tab");
        await stepTo("folding.ts");
        await editor.capture("mru-list");

        await editor.sendKey("Ctrl+Tab");
        await stepTo("sample.ts");
        await editor.capture("mru-deeper");

        await editor.sendKey("Ctrl+ArrowUp");
        await stepTo("folding.ts");
        await editor.capture("arrow-up");

        await editor.sendKey("Ctrl+ArrowDown");
        await stepTo("sample.ts");
        await editor.capture("arrow-down");

        // Ctrl+PgDn — по порядку табов, не по MRU.
        await editor.sendKey("Ctrl+PageDown");
        await editor.waitForText((t) => !t.includes("╭"));
        await editor.capture("visual-cycle");
    },
});
