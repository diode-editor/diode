import { resolve } from "node:path";

import { frameLine } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-editor-title");

const CHECK = "";
const DISCARD = "";
const TAB_ROW = 1;

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

        // An SVG icon can't be drawn, so the item goes into the "⋯" menu to the right of the tabs.
        const overflow = await editor.waitForText((t) => tabRow(t).trimEnd().endsWith("⋯"));
        await editor.capture("overflow");
        await editor.click(frameLine(overflow, TAB_ROW).lastIndexOf("⋯"), TAB_ROW);
        await editor.waitForText((t) => t.includes("Editor Title Demo: Open Agent"));
        await editor.capture("overflow-menu");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("title:open"));

        await runCommand(editor, "Editor Title Demo: Propose Changes");
        const proposed = await editor.waitForText((t) => tabRow(t).includes(CHECK) && tabRow(t).includes(DISCARD));
        await editor.capture("proposed");
        await editor.click(frameLine(proposed, TAB_ROW).indexOf(CHECK), TAB_ROW);
        await editor.waitForText((t) => t.includes("title:accepted") && !tabRow(t).includes(CHECK));
        await editor.capture("accepted");
    },
});
