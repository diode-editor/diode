import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";
import { RegistryServer } from "../helpers/registryServer.ts";

import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// The registry fixture is built at module import; the server starts in `prepare`, so loading the scenario list
// opens no socket.

const ID = "test.sample-lang";
const registryDir = await createRegistryFixture(
    join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"),
    [
        {
            id: ID,
            version: "0.0.2",
            sourceDir: resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
            displayName: "Sample Lang",
            description: "Synthetic marketplace extension: its own language and grammar",
            readme: "# Sample Lang\n\nA slow download: the page, the list and the status bar show the install.",
        },
    ],
);

const registry = new RegistryServer(registryDir, { holdArtifacts: true });

export default defineScenario({
    name: "extensions-install-progress",
    title: "Extensions: an install in progress on the page, in the list and in the status bar",
    open: [repoRoot],
    // Read after `prepare`: the server's port is known only once it listens.
    get extraArgs() {
        return [`--registry=${registry.url}`];
    },
    // The headless DSL cannot encode a real Ctrl+Shift+X, so the command is bound to F6.
    userKeybindings: [
        { key: "f6", command: "workbench.view.extensions" },
        { key: "f7", command: "workbench.action.increaseSidebarWidth" },
    ],
    cols: 110,
    rows: 28,
    prepare: () => registry.listen(),
    async run(editor) {
        try {
            await editor.waitForText((t) => t.includes(explorerTitle(repoRoot)));
            await editor.sendKey("F6");
            await editor.waitForText((t) => t.includes("MARKETPLACE"));
            for (let i = 0; i < 3; i++) await editor.sendKey("F7");

            await editor.waitForNode("#extensionsGroup-marketplace-test-sample-lang");
            await editor.clickNode("#extensionsGroup-marketplace-test-sample-lang");
            await editor.waitForNode("#extensionPage-test-sample-lang");
            await editor.waitForText((t) => t.includes("Not installed"));

            // The page focuses its first button, which is Install. Half the file is in: the page button and the
            // status bar carry the percent, the list row says Installing.
            await editor.sendKey("Enter");
            await editor.waitForText(
                (t) =>
                    /Installing \d+%/u.test(t) &&
                    /Installing test\.sample-lang \(\d+%\)/u.test(t) &&
                    /Sample Lang {2}0\.0\.2 {2}Installing/u.test(t) &&
                    t.includes("Installing…"),
            );
            await editor.capture("downloading");

            registry.release();
            await editor.waitForText((t) => t.includes("Reload Window"));
            await editor.capture("installed");
        } finally {
            await registry.close();
        }
    },
});
