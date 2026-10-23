import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The registry fixture is built at module import: `extraArgs` and `installVsix` need its paths before the editor starts.

const ID = "test.lazy-version";
const DAY = 24 * 60 * 60 * 1000;

const registry = await createRegistryFixture(
    join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"),
    [
        { version: "1.0.0", age: 60 * DAY },
        { version: "1.1.0", age: 2 * DAY },
    ].map(({ version, age }) => ({
        id: ID,
        version,
        sourceDir: resolve(repoRoot, "e2e", "marketplace", "lazy-extension"),
        displayName: "Lazy Version",
        description: "Its command loads a module from the extension directory on every call",
        publishedAt: new Date(Date.now() - age).toISOString(),
    })),
);

export default defineScenario({
    name: "extension-version-rollback",
    title: "Extensions: rolling back to an older version with Install Specific Version... (the version gets pinned)",
    open: [repoRoot],
    extraArgs: [`--registry=${registry}`],
    installVsix: [join(registry, "artifacts", `${ID}-1.1.0.vsix`)],
    // The headless DSL cannot encode a real Ctrl+Shift+X, so the commands are bound to function keys.
    userKeybindings: [
        { key: "f6", command: "workbench.view.extensions" },
        { key: "f8", command: "lazyVersion.show" },
    ],
    cols: 110,
    rows: 28,
    async run(editor) {
        await editor.waitForReady();
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("MARKETPLACE"));

        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-lazy-version");
        await editor.waitForText((t) => t.includes("Install Specific Version..."));
        await editor.capture("page");

        // The page focuses its first button, which is "Install Specific Version...".
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Select Version to Install") && t.includes("(current)"));
        await editor.capture("version-picker");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Installed 1.0.0") && t.includes("Update to 1.1.0"));
        await editor.capture("rolled-back");

        // The reply may never arrive: the window restarts along with the socket. Focus is on Reload Window.
        await editor.sendKey("Enter").catch(() => undefined);
        await editor.reconnect();
        await editor.waitForReady();
        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("lazy version 1.0.0"), { timeoutMs: 30_000 });
        await editor.capture("after-reload");
    },
});
