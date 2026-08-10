import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Сплиты области редактора (docs/TODO/EditorGroups.md, фаза 3): Ctrl+\ делит
// активную группу пополам с дублем вкладки, полоса групп живёт в EditorPartElement
// (веса + саш), фокус групп — чордом Ctrl+K 1/2 (работает на любом tier; e2e-порт
// «клавиатуры» инспектора не проходит через терминальные ограничения, но чорд —
// путь, который есть у всех пользователей). Drag саша меняет пропорции.

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

        // Split Editor: две группы, обе показывают активную вкладку (дубль).
        await editor.sendKey("Ctrl+\\");
        await editor.waitForNode("#editorGroup-2");
        await editor.capture("split");

        // Фокус первой группы чордом Ctrl+K 1; активная вкладка групп независима:
        // в первой переключаемся на folding.ts — вторая остаётся на sample.ts.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("1");
        await editor.sendKey("Ctrl+6"); // alternate editor внутри группы 1
        await editor.waitForText((t) => t.includes("folding.ts") && t.includes("sample.ts"));
        await editor.capture("independent-tabs");

        // Drag саша: граница групп уезжает вправо, пропорции меняются.
        const part = await editor.waitForNode("#editorPart");
        const sashX = part.box.x + Math.floor(part.box.width / 2);
        const midY = part.box.y + Math.floor(part.box.height / 2);
        await editor.sendMouse({ action: "press", button: "left", x: sashX, y: midY });
        await editor.sendMouse({ action: "move", button: "left", x: sashX + 20, y: midY });
        await editor.sendMouse({ action: "release", button: "left", x: sashX + 20, y: midY });
        await editor.capture("sash-resized");

        // Тумблер оси через палитру (Shift+Alt+0 living только на kitty/csi-u;
        // headless-инспектор шлёт клавиши мимо терминала, но палитра — путь,
        // который есть везде): те же группы становятся рядами (US-19).
        await editor.sendKey("Ctrl+P");
        await editor.waitForNode("#quickInput");
        await editor.sendText(">Toggle Vertical/Horizontal");
        await editor.sendKey("Enter");
        await editor.capture("rows-layout");
    },
});
