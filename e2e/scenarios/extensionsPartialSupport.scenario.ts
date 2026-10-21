import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// A dedicated registry fixture: the shared one sets card states up for the badge demo, and the support marker
// is an orthogonal axis.

const registry = resolve(repoRoot, "e2e", "fixtures", "registry-partial");

export default defineScenario({
    name: "extensions-partial-support",
    title: "Extensions view: a partially supported extension",
    open: [repoRoot],
    extraArgs: [`--registry=${registry}`],
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
        await editor.waitForText((t) => t.includes("Acme Copilot-ish"));
        // The default sidebar is too narrow for the whole badge.
        for (let i = 0; i < 4; i++) await editor.sendKey("F7");
        await editor.waitForText((t) => t.includes("Partial"));
        await editor.capture("viewlet");

        // The marked extension's page: the heading in the header, the lists in the body.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Partial support: some features do not work in Diode"));
        await editor.waitForText((t) => t.includes("Does not work:"));
        await editor.waitForText((t) => t.includes("Chat panel does not open"));
        await editor.capture("page");
    },
});
