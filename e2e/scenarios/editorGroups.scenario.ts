import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Фокус групп — чордом Ctrl+K 1/2: он есть у всех пользователей на любом tier.

const fileA = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const fileB = resolve(repoRoot, "e2e", "fixtures", "folding.ts");

export default defineScenario({
    name: "editor-groups",
    title: "Editor groups: split, focus, sash resize",
    open: [repoRoot, fileA, fileB],
    cols: 140,
    rows: 36,
    async run(editor) {
        await editor.waitForText((t) => t.includes("sample.ts") && t.includes("folding.ts"));

        await editor.sendKey("Ctrl+\\");
        await editor.waitForNode("#editorGroup-2");
        await editor.capture("split");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("1");
        await editor.sendKey("Ctrl+6"); // alternate editor внутри группы 1
        await editor.waitForText((t) => t.includes("folding.ts") && t.includes("sample.ts"));
        await editor.capture("independent-tabs");

        const part = await editor.waitForNode("#editorPart");
        const sashX = part.box.x + Math.floor(part.box.width / 2);
        const midY = part.box.y + Math.floor(part.box.height / 2);
        await editor.sendMouse({ action: "press", button: "left", x: sashX, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: sashX + 20, y: midY });
        await editor.sendMouse({ action: "release", button: "left", x: sashX + 20, y: midY });
        await editor.capture("sash-resized");

        // US-33: у каждой группы свой виджет Find со своим запросом.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("2");
        await editor.sendKey("Ctrl+F");
        await editor.sendText("beta");
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("1");
        await editor.sendKey("Ctrl+F");
        await editor.sendText("greet");
        await editor.capture("two-find-widgets");
        await editor.sendKey("Escape");

        // Тумблер оси — палитрой: Shift+Alt+0 живёт только на kitty/csi-u (US-19).
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText(">Toggle Vertical/Horizontal");
        await editor.sendKey("Enter");
        await editor.capture("rows-layout");
    },
});
