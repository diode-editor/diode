import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { findTextCell, frameLine } from "../helpers/frame.ts";
import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The registry fixture is built at module import: `extraArgs` and `installVsix` need its paths before the editor starts.

const SOURCE = resolve(repoRoot, "e2e", "marketplace", "sample-extension");

const registry = await createRegistryFixture(
    join(mkdtempSync(join(tmpdir(), "diode-scenario-registry-")), "registry"),
    [
        // The index's latest 2.0.0 fits no build: the update goes to the newest compatible 1.1.0.
        { id: "test.formatter", displayName: "Formatter", versions: ["1.0.0", "1.1.0", "2.0.0"] },
        { id: "test.linter", displayName: "Linter", versions: ["1.0.0", "1.1.0"] },
    ].flatMap(({ id, displayName, versions }) =>
        versions.map((version) => ({
            id,
            version,
            sourceDir: SOURCE,
            displayName,
            ...(version === "2.0.0" ? { engines: { vscode: "^99.0.0" } } : {}),
        })),
    ),
);

export default defineScenario({
    name: "extension-update-all",
    title: "Extensions: Check for Extension Updates → @outdated → Update All Extensions → Reload Window",
    open: [repoRoot],
    extraArgs: [`--registry=${registry}`],
    installVsix: ["test.formatter", "test.linter"].map((id) => join(registry, "artifacts", `${id}-1.0.0.vsix`)),
    cols: 110,
    rows: 28,
    async run(editor) {
        await editor.waitForReady();

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Check for Extension Updates");
        await editor.waitForText((t) => t.includes("Extensions: Check for Extension Updates"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("@outdated") && t.includes("Linter"));
        await editor.capture("outdated");

        // The section's "⋯" menu carries both commands.
        const frame = await editor.captureFrame();
        let menu: { x: number; y: number } | null = null;
        for (let y = 0; y < frame.rows && menu === null; y++) {
            const line = frameLine(frame, y);
            if (line.includes("EXTENSIONS") && line.includes("⋯")) menu = { x: line.indexOf("⋯"), y };
        }
        if (menu === null) throw new Error("no ⋯ on the EXTENSIONS header");
        await editor.click(menu.x, menu.y);
        await editor.waitForText((t) => t.includes("Update All Extensions"));
        await editor.capture("menu");

        const item = findTextCell(await editor.captureFrame(), "Update All Extensions");
        await editor.click(item!.x + 1, item!.y);
        await editor.waitForText((t) => t.includes("Updated 2 extensions."), { timeoutMs: 30_000 });
        await editor.capture("updated");

        const reload = findTextCell(await editor.captureFrame(), "Reload Window");
        // The reply may never arrive: the window restarts along with the socket.
        await editor.click(reload!.x + 1, reload!.y).catch(() => undefined);
        await editor.reconnect();
        await editor.waitForReady();
        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Check for Extension Updates");
        await editor.waitForText((t) => t.includes("Extensions: Check for Extension Updates"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("All extensions are up to date."));
        await editor.capture("after-reload");
    },
});
