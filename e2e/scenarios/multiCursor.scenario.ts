import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The frame is the only witness: cursors are drawn as cells (there is one hardware cursor, and `gridToSvg` doesn't
// carry it into the PNG). Many terminals grab Alt+click, so here it goes through the inspector.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "multi-cursor",
    title: "Мульти-курсор: Ctrl+D, Ctrl+Shift+L, Ctrl+Alt+↓, Alt+клик",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));
        await editor.capture("editor");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+D");
        await editor.sendKey("Ctrl+D");
        await editor.waitForText((t) => t.includes("(2 selections)"));
        await editor.capture("select-next-match");

        // The harness is a legacy terminal: Ctrl+Shift+L is indistinguishable from Ctrl+L and disabled by `when`,
        // so the chord fallback applies.
        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("selections)"));
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+A");
        await editor.waitForText((t) => t.includes("(2 selections)"));
        await editor.capture("select-all-occurrences");

        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.sendKey("Ctrl+Alt+ArrowDown");
        await editor.waitForText((t) => t.includes("(3 selections)"));
        await editor.capture("cursors-below");

        await editor.sendKey("/");
        await editor.sendKey("/");
        await editor.waitForText((t) => t.includes("//// fixture"));
        await editor.capture("typed-into-all");

        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("selections)"));
        await editor.clickNode("EditorElement", { altKey: true, dx: 12, dy: 4 });
        await editor.waitForText((t) => t.includes("(2 selections)"));
        await editor.capture("alt-click");
    },
});
