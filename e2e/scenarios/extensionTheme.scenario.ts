import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The registry fixture is built at module import: `extraArgs` needs its path before the editor starts.

const registry = await createRegistryFixture(join(mkdtempSync(join(tmpdir(), "diode-scenario-theme-")), "registry"), [
    {
        id: "test.sample-theme",
        version: "0.0.1",
        sourceDir: resolve(repoRoot, "e2e", "fixtures", "sample-theme"),
        displayName: "Sample Theme",
        description: "Синтетическое расширение магазина: три цветовые темы",
        readme: "# Sample Theme\n\nТемы Sample Dark / Sample Light / Sample Dimmed для демо магазина.",
    },
]);

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "extension-theme",
    title: "Extensions: тема из магазина — Install → Reload Window → Color Theme",
    open: [repoRoot, sampleFile],
    extraArgs: [`--registry=${registry}`],
    // The headless DSL cannot encode real chords (Ctrl+Shift+X, Ctrl+K Ctrl+T), so commands are bound to F-keys.
    userKeybindings: [
        { key: "f6", command: "workbench.view.extensions" },
        { key: "f7", command: "workbench.action.increaseSidebarWidth" },
        { key: "f8", command: "workbench.action.selectTheme" },
    ],
    cols: 110,
    rows: 28,
    // On Windows, Reload Window from a scenario started in repoRoot brings up a
    // window with `diode.exe` in a tab and no sidebar (in the CI safety net the
    // frame after reconnect never shows EXPLORER); the functional e2e reloading
    // from an isolated workspace passes on Windows. Tracked in docs/TODO/E2E.md.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("EXPLORER"));
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("MARKETPLACE"));
        for (let i = 0; i < 3; i++) await editor.sendKey("F7");

        // Extension page: focus the list, first catalog entry, Enter.
        await editor.sendKey("Tab");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForNode("#extensionPage-test-sample-theme");
        await editor.waitForText((t) => t.includes("Not installed"));

        // The page focuses its first button, which is Install; after installation
        // Reload Window takes its place.
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Reload Window"));
        await editor.capture("installed");

        // The reply to this input may never arrive: the window restarts along with
        // the socket. The new window comes up with the same arguments, and with the
        // extension's themes in the registry.
        await editor.sendKey("Enter").catch(() => undefined);
        await editor.reconnect();
        await editor.waitForText((t) => t.includes("EXPLORER"), { timeoutMs: 60_000 });

        // Color Theme picker: the extension's themes follow the built-in ones; filter
        // by name, and live preview repaints the window before Enter.
        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Select Color Theme"));
        await editor.sendText("Sample Dark");
        await editor.waitForText((t) => t.includes("Sample Dark") && !t.includes("Sample Light"));
        await editor.capture("picker");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Select Color Theme"));
        await editor.capture("applied");
    },
});
