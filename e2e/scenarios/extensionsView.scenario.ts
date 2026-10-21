import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const registry = resolve(repoRoot, "e2e", "fixtures", "registry");
// user-data already has test.tab-setter@0.0.1 while the registry knows 0.0.2, so the
// frame shows every card state at once: available, update, incompatible.
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-tab-setter");

export default defineScenario({
    name: "extensions-view",
    title: "Extensions view: каталог магазина и страница расширения",
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
        await editor.waitForText((t) => t.includes("EXPLORER"));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("MARKETPLACE"));
        await editor.waitForText((t) => t.includes("Acme Sample"));
        // The default sidebar is too narrow for the whole badges.
        for (let i = 0; i < 4; i++) await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Incompatible"));
        await editor.capture("viewlet");

        // Extension page: focus the list, first catalog entry, Enter.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("This readme comes from the registry meta"));
        await editor.capture("page");
    },
});
