import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Демо Н3: палитра темы живёт в корневом var-scope, виджеты ссылаются на
// токены — смена темы перекрашивает всё дерево одним пушем (без updateStyles
// по компонентам), а пикер тем (quickpick) впервые темизирован сам.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "theme-swap",
    title: "Смена темы: токены + корневой var-scope (Н3)",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("dark-plus");

        // Пикер тем — сам quickpick, теперь на токенах quickInput.*/list.*.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+T");
        await editor.waitForText((t) => t.includes("Light+"));
        await editor.capture("picker");

        // Live preview + применение светлой темы: hot-swap = один setStyleVars
        // на корне, дальше каскад.
        await editor.sendText("Light+");
        await editor.waitForText((t) => t.includes("Light+"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("light-plus");
    },
});
