import { resolve } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Панель действий группы (`contributes.menus["editor/title"]`): фикстурное
// расширение `editor-title-demo` вкладывает её в форме стокового Claude Code.
// Кадры: пункт с SVG-иконкой под `config.editorTitleDemo.useTerminal` — «⋯»
// справа от вкладок → его попап с подписью → «предложенный дифф»
// (`setContext`) зажигает кнопки ✓ и ↺ из `$(check)`/`$(discard)` → клик по ✓
// исполняет accept, ключ гаснет, кнопки уходят.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-editor-title");

const CHECK = "";
const DISCARD = "";
/** Ряд вкладок — под меню-баром. */
const TAB_ROW = 1;

/** Исполняет команду через палитру (F1 → заголовок → Enter). */
async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

const tabRow = (text: string): string => text.split("\n")[TAB_ROW] ?? "";

export default defineScenario({
    name: "editor-title",
    title: "Панель действий группы: editor/title расширения справа от вкладок",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 30,
    async run(editor) {
        await editor.waitForText((t) => t.includes("title:-"), { timeoutMs: 20_000 });

        // SVG-иконку не нарисовать — пункт в «⋯» справа от вкладок.
        const overflow = await editor.waitForText((t) => tabRow(t).trimEnd().endsWith("⋯"));
        await editor.capture("overflow");
        await editor.click(frameLine(overflow, TAB_ROW).lastIndexOf("⋯"), TAB_ROW);
        await editor.waitForText((t) => t.includes("Editor Title Demo: Open Agent"));
        await editor.capture("overflow-menu");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("title:open"));

        // «Предложенный дифф»: кнопки accept/reject из кодиконов.
        await runCommand(editor, "Editor Title Demo: Propose Changes");
        const proposed = await editor.waitForText((t) => tabRow(t).includes(CHECK) && tabRow(t).includes(DISCARD));
        await editor.capture("proposed");
        await editor.click(frameLine(proposed, TAB_ROW).indexOf(CHECK), TAB_ROW);
        await editor.waitForText((t) => t.includes("title:accepted") && !tabRow(t).includes(CHECK));
        await editor.capture("accepted");
    },
});
