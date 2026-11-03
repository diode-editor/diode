import { resolve } from "node:path";

import { findTextCell, frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-ungrouped-menu");

export default defineScenario({
    name: "ungrouped-menu-item",
    title: "contributes.menus: an item without a group is the last section of the editor context menu",
    seedUserData: userData,
    open: [sampleFile],
    cols: 100,
    rows: 40,
    async run(editor) {
        await editor.waitForText((t) => t.includes("menu:-"), { timeoutMs: 20_000 });

        await editor.sendKey("Shift+F10");
        const menu = await editor.waitForText((t) => t.includes("Ungrouped Demo: Show AST"));
        await editor.capture("context-menu");

        const nav = findTextCell(menu, "Ungrouped Demo: Navigate")?.y;
        const palette = findTextCell(menu, "Command Palette")?.y;
        const ast = findTextCell(menu, "Ungrouped Demo: Show AST")?.y ?? -1;
        if (nav === undefined || palette === undefined) throw new Error(`menu is missing items:\n${frameToText(menu)}`);
        if (nav > palette) throw new Error(`the navigation item is not above Command Palette:\n${frameToText(menu)}`);
        if (ast < palette) throw new Error(`the ungrouped item is not below Command Palette:\n${frameToText(menu)}`);

        await editor.sendKey("Escape");
    },
});
