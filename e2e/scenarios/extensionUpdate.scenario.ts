import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The registry fixture is built at module import: `extraArgs` and `installVsix` need its paths before the editor starts.

const ID = "test.lazy-version";

const registry = await createRegistryFixture(
    join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"),
    ["1.0.0", "1.1.0"].map((version) => ({
        id: ID,
        version,
        sourceDir: resolve(repoRoot, "e2e", "marketplace", "lazy-extension"),
        displayName: "Lazy Version",
        description: "Its command loads a module from the extension directory on every call",
    })),
);

export default defineScenario({
    name: "extension-update",
    title: "Extensions: updating an extension under a running window (the old version keeps working until reload)",
    open: [repoRoot],
    extraArgs: [`--registry=${registry}`],
    installVsix: [join(registry, "artifacts", `${ID}-1.0.0.vsix`)],
    // The headless DSL cannot encode a real Ctrl+Shift+X, so the commands are bound to function keys.
    userKeybindings: [
        { key: "f6", command: "workbench.view.extensions" },
        { key: "f8", command: "lazyVersion.show" },
        { key: "f9", command: "workbench.action.reloadWindow" },
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
        await editor.waitForText((t) => t.includes("Update to 1.1.0"));
        await editor.capture("outdated");

        // The page focuses its first button, which is "Update to 1.1.0".
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Installed 1.1.0"));
        await editor.capture("updated");

        // The command loads its module only now: from the 1.0.0 directory, which the update left in place.
        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("lazy version 1.0.0"));
        await editor.capture("old-version-still-works");

        // The reply may never arrive: the window restarts along with the socket.
        await editor.sendKey("F9").catch(() => undefined);
        await editor.reconnect();
        await editor.waitForReady();
        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("lazy version 1.1.0"), { timeoutMs: 30_000 });
        await editor.capture("after-reload");
    },
});
