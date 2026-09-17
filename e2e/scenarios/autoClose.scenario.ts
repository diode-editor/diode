import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// Скобки при наборе по language configuration стокового пака typescript-basics:
// открывающая вставляет пару с кареткой внутри, набор закрывающей перешагивает
// её (typeover), а скобка/кавычка при непустом выделении обрамляет его
// (auto-surround), а не затирает. Пары приезжают из
// extensions/typescript-basics/language-configuration.json (PR 1), сами
// решения — editor/common/languages/autoClosing.ts.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

async function typeText(editor: { sendKey(name: string): Promise<void> }, text: string): Promise<void> {
    for (const ch of text) {
        await editor.sendKey(ch);
    }
}

export default defineScenario({
    name: "auto-close",
    title: "Auto-closing pairs, typeover и auto-surround при наборе",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        // Новая строка после объявления → набор `{` вставляет пару, каретка внутри.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await typeText(editor, "const pair = {");
        await editor.waitForText((t) => t.includes("const pair = {}"));
        await editor.capture("autoclose-pair");

        // Набор `}` НЕ плодит вторую скобку — перешагивает вставленную; `;` в хвост.
        await typeText(editor, "};");
        await editor.waitForText((t) => t.includes("const pair = {};") && !t.includes("{}}"));
        await editor.capture("typeover");

        // Auto-surround: выделяем имя и жмём кавычку — имя обёрнуто, не затёрто.
        await editor.sendKey("Home");
        for (let i = 0; i < "const ".length; i++) await editor.sendKey("ArrowRight");
        for (let i = 0; i < "pair".length; i++) await editor.sendKey("Shift+ArrowRight");
        await editor.sendKey("'");
        await editor.waitForText((t) => t.includes("const 'pair' = {};"));
        await editor.capture("auto-surround");
    },
});
