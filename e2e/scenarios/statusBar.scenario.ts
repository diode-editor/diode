import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Демо статус-бара после пересборки на примитивы (HFlex + TextLabel + Filler):
// обычная ширина — левые сегменты слева, правые прижаты к правому краю с
// клеткой паддинга; узкий терминал — flex-семантика переполнения (середина
// схлопывается, правая группа теряет выравнивание и обрезается краем экрана).

const sampleFile = resolve(repoRoot, "AGENTS.md");

export default defineScenario({
    name: "statusBar",
    title: "Status bar composed from tuidom primitives",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        // Правые сегменты появляются после открытия файла.
        await editor.waitForText((t) => t.includes("Ln 1, Col 1") && t.includes("UTF-8"));
        await editor.capture("normal-width");

        // Узкий терминал: правая группа больше не влезает — обрезается справа
        // (слева теперь живут ветка и sync-сегмент SCM, ширина плавает по имени
        // ветки — проверяем сам факт вытеснения, а не конкретный обрезок).
        await editor.resize(40, 16);
        await editor.waitForText((t) => !t.includes("UTF-8"));
        await editor.capture("narrow-overflow");
    },
});
