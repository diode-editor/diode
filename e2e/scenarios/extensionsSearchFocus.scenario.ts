import { resolve } from "node:path";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

const registry = resolve(repoRoot, "e2e", "fixtures", "registry");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-tab-setter");

export default defineScenario({
    name: "extensions-search-focus",
    title: "Extensions view: Enter in the search box moves the focus to the MARKETPLACE list",
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
        await editor.waitForNode("#extensionsGroup-marketplace-old-legacy");
        for (let i = 0; i < 4; i++) await editor.sendKey("F7");

        // Enter leaves the search box for the first row; Down then walks the list, not the box.
        await editor.sendText("e");
        await editor.waitForText((t) => t.includes("Tab Setter"));
        await editor.sendKey("Enter");
        await editor.sendKey("ArrowDown");
        await editor.waitForState(
            "#extensionsList",
            (state) => state?.cursorId === "extensionsGroup-marketplace-test-tab-setter",
        );
        await editor.capture("list");

        // Enter in the list opens the extension page.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("test.tab-setter"));
        await editor.capture("page");
    },
});
