import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The registry fixture is built at module import: `extraArgs` needs its path before the editor starts.

const registry = await createRegistryFixture(
    join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"),
    [
        {
            id: "test.sample-lang",
            version: "0.0.2",
            sourceDir: resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
            displayName: "Sample Lang",
            description: "Synthetic marketplace extension: its own language and grammar",
            readme: "# Sample Lang\n\nThe .diodesample language for the marketplace demo: install the extension from this page.",
        },
    ],
);

export default defineScenario({
    name: "extensions-install",
    title: "Extensions: installing an extension from its marketplace page",
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
        for (let i = 0; i < 3; i++) await editor.sendKey("F7");

        // Extension page: focus the list, first catalog entry, Enter.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-sample-lang");
        await editor.waitForText((t) => t.includes("Not installed"));
        await editor.capture("page");

        // The page focuses its first button, which is Install.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Reload Window"));
        await editor.capture("installed");
    },
});
