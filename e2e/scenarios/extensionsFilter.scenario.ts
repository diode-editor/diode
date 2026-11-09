import { resolve } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

const registry = resolve(repoRoot, "e2e", "fixtures", "registry");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-tab-setter");

const CATEGORY_QUERY = "@category:themes";

export default defineScenario({
    name: "extensions-filter",
    title: "Extensions view: @category and @installed filters in the search box",
    open: [repoRoot],
    extraArgs: [`--registry=${registry}`],
    seedUserData: userData,
    // The headless DSL cannot encode a real Ctrl+Shift+X, so the command is bound to F6.
    userKeybindings: [
        { key: "f6", command: "workbench.view.extensions" },
        { key: "f7", command: "workbench.action.increaseSidebarWidth" },
    ],
    cols: 110,
    rows: 28,
    async run(editor) {
        await editor.waitForText((t) => t.includes(explorerTitle(repoRoot)));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("Legacy Thing"));
        for (let i = 0; i < 4; i++) await editor.sendKey("F7");

        // The fixture registry has one theme: it alone is left, in MARKETPLACE.
        await editor.sendText(CATEGORY_QUERY);
        await editor.waitForText((t) => t.includes("Acme Sample") && !t.includes("Legacy Thing"));
        await editor.capture("category");

        // One INSTALLED list: the tab setter the user data already has.
        for (let i = 0; i < CATEGORY_QUERY.length; i++) await editor.sendKey("Backspace");
        await editor.sendText("@installed");
        await editor.waitForText((t) => t.includes("Tab Setter") && !t.includes("MARKETPLACE"));
        await editor.capture("installed");
    },
});
