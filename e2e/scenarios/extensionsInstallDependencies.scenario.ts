import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Lang Pack has no contributions of its own, only a dependency on Sample Lang.

const registry = await createRegistryFixture(
    join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"),
    [
        {
            id: "test.lang-pack",
            version: "0.0.1",
            sourceDir: resolve(repoRoot, "e2e", "marketplace", "dependent-extension"),
            displayName: "Lang Pack",
            description: "Depends on Sample Lang",
            readme: "# Lang Pack\n\nNo contributions of its own: installing it brings Sample Lang along.",
        },
        {
            id: "test.sample-lang",
            version: "0.0.2",
            sourceDir: resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
            displayName: "Sample Lang",
            description: "Language .diodesample with a grammar",
        },
    ],
);

export default defineScenario({
    name: "extensions-install-dependencies",
    title: "Extensions: installing pulls in extensionDependencies",
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
        for (let i = 0; i < 4; i++) await editor.sendKey("F7");
        // Lang Pack's page, the first catalog entry: focus the list, Enter.
        // No filter: it would narrow the installed list too, and the frame needs both.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-lang-pack");

        // The page focuses its first button, which is Install.
        await editor.sendKey("Enter");
        // The installed list shows both Lang Pack and Sample Lang, which came with it;
        // both await a reload.
        await editor.waitForText(
            (t) => t.includes("Reload Window") && t.includes("INSTALLED") && /Sample Lang\s+0\.0\.2\s+Reload/u.test(t),
        );
        await editor.capture("installed-with-dependency");
    },
});
