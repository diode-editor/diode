import { cpSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Сегменты компактной строки Explorer'а (explorer.compactFolders), как
// `CompressedNavigationController` у эталона: у строки «src/main/java/com/example»
// есть текущий сегмент (по умолчанию последний, подчёркнут), Left/Right ходят
// по сегментам, клик делает сегмент текущим, контекстное меню и действия идут
// в его папку. Сценарий: Left → текущий «com»; правый клик по «java» → New File…
// → файл ложится в src/main/java, цепочка рвётся на «src/main/java» + «com».
//
// Фикстура копируется во временный каталог: сценарий пишет на диск.

const workspace = mkdtempSync(join(tmpdir(), "diode-compact-segments-demo-"));
cpSync(resolve(repoRoot, "e2e", "fixtures", "compactFolders"), workspace, { recursive: true });

// Строка дерева « ⌄ src/main/java/com/example»: отступ 1, шеврон, пробел —
// метка с колонки 3: src 3–5, main 7–10, java 12–15, com 17–19.
const JAVA_COLUMN = 13;
const MAIN_COLUMN = 8;

export default defineScenario({
    name: "explorer-compact-segments",
    title: "explorer.compactFolders: сегменты компактной строки — выбор и действия в папку сегмента",
    open: [workspace],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("src") && t.includes("README.md"));
        // Клик по «src» выделяет строку; → раскрывает её — цепочка находится
        // лениво, как у эталона, и текущим становится последний сегмент.
        await editor.clickNode("TreeViewElement", { dx: 4, dy: 0 });
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("src/main/java/com/example") && t.includes("App.java"));
        await editor.capture("last-segment");

        // Left — к сегменту «com» (строка не сворачивается).
        await editor.sendKey("ArrowLeft");
        await editor.capture("left-to-com");

        // Клик мышью по «main» делает его текущим.
        await editor.clickNode("TreeViewElement", { dx: MAIN_COLUMN, dy: 0 });
        await editor.capture("click-main");

        // Правый клик по «java» → New File… → имя → файл в src/main/java.
        const tree = await editor.waitForNode("TreeViewElement");
        const x = tree.box.x + JAVA_COLUMN;
        await editor.sendMouse({ action: "press", button: "right", x, y: tree.box.y });
        await editor.sendMouse({ action: "release", button: "right", x, y: tree.box.y });
        await editor.waitForText((t) => t.includes("New File..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Enter file name"));
        await editor.sendText("Probe.java");
        await editor.waitForText((t) => t.includes("Probe.java"));
        await editor.sendKey("Enter");
        // Хвост цепочки («com») стоит свёрнутым: его цепочку дерево узнает,
        // когда его раскроют (сжатие ленивое).
        await editor.waitForText(
            (t) => t.includes("src/main/java") && !t.includes("src/main/java/com") && t.includes("Probe.java"),
        );
        if (!existsSync(join(workspace, "src", "main", "java", "Probe.java"))) {
            throw new Error("New File… на сегменте «java» создал файл не в src/main/java");
        }
        await editor.capture("new-file-in-segment");
    },
});
