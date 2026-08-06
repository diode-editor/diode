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
        // Ширина 30, а не 40: сценарий открывает сам репозиторий, и на CI ветка
        // называется коротко (`main`) — при 40 колонках левая группа
        // (`main ↓0 ↑0 legacy`) и правая (`Ln 1, Col 1  UTF-8`) влезали встык,
        // UTF-8 не вытеснялся и wait висел до таймаута. В 30 колонок обе группы
        // не помещаются даже при односимвольном имени ветки.
        await editor.resize(30, 16);
        await editor.waitForText((t) => !t.includes("UTF-8"));
        await editor.capture("narrow-overflow");
    },
});
