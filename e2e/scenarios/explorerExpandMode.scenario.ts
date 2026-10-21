import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleDir = resolve(repoRoot, "e2e", "fixtures", "compactFolders");

export default defineScenario({
    name: "explorer-expand-mode",
    title: "workbench.tree.expandMode: клик по имени папки и Enter раскрывают её",
    open: [sampleDir],
    cols: 100,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("src") && t.includes("README.md"));
        await editor.capture("collapsed");

        // Отступ 1, шеврон, пробел — имя с колонки 3.
        await editor.clickNode("TreeViewElement", { dx: 4, dy: 0 });
        await editor.waitForText((t) => t.includes("src/main/java/com/example") && t.includes("App.java"));
        await editor.capture("click-expands");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("src/main/java/com/example") && !t.includes("App.java"));
        await editor.capture("enter-collapses");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("App.java"));
        await editor.capture("enter-expands");
    },
});
