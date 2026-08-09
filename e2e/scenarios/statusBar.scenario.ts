import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Демо статус-бара: обычная ширина — левые сегменты слева, правые прижаты к
// правому краю с клеткой паддинга; наведение — подсветка кликабельного
// сегмента; правый клик — переключатель видимости сегментов; узкий терминал —
// flex-семантика переполнения (середина схлопывается, правая группа теряет
// выравнивание и обрезается краем экрана).

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

        // Наведение на кликабельный сегмент (ветка SCM) — блок подсвечивается
        // statusBarItem.hoverBackground вместе с краевыми пробелами.
        const branch = await editor.waitForNode("#statusBarItem-status-scm-branch");
        await editor.sendMouse({ action: "move", button: "none", x: branch.box.x + 2, y: branch.box.y });
        await editor.capture("segment-hover");

        // Правый клик по полосе — переключатель видимости сегментов: галочки у
        // видимых, «Hide 'X'» для сегмента под курсором. Меню флипается вверх,
        // полоса — нижний ряд.
        await editor.sendMouse({ action: "press", button: "right", x: branch.box.x + 2, y: branch.box.y });
        await editor.sendMouse({ action: "release", button: "right", x: branch.box.x + 2, y: branch.box.y });
        await editor.waitForText((t) => t.includes("Hide 'Source Control'"));
        await editor.capture("visibility-menu");
        await editor.sendKey("Escape");

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
