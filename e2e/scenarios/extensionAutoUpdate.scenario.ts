import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { cliOk, defaultProfileFile } from "../helpers/extensionsDisk.ts";
import { findTextCell } from "../helpers/frame.ts";
import { createRegistryFixture } from "../helpers/registryFixture.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The registry fixture is built at module import: `extraArgs` needs its path before the editor starts.

const SOURCE = resolve(repoRoot, "e2e", "marketplace", "sample-extension");
const IDS = ["test.formatter", "test.linter"];
const LONG_AGO = "2026-01-01T00:00:00Z";

const work = mkdtempSync(join(tmpdir(), "diode-scenario-auto-update-"));
const registry = await createRegistryFixture(
    join(work, "registry"),
    IDS.flatMap((id) =>
        ["1.0.0", "1.1.0"].map((version) => ({
            id,
            version,
            sourceDir: SOURCE,
            displayName: id === "test.formatter" ? "Formatter" : "Linter",
            publishedAt: LONG_AGO,
        })),
    ),
);
const userData = join(work, "user-data");

export default defineScenario({
    name: "extension-auto-update",
    title: "Startup → the background check 10 s later → Updated 2 extensions → Reload Window → the new versions",
    open: [repoRoot],
    extraArgs: [`--registry=${registry}`],
    seedUserData: userData,
    cols: 110,
    rows: 28,
    // As if installed from the marketplace earlier: the CLI pins a given version, the pin comes off again.
    async prepare() {
        for (const id of IDS) {
            await cliOk(["--user-data-dir", userData, "--registry", registry, "--install-extension", `${id}@1.0.0`]);
        }
        const file = defaultProfileFile(userData);
        const entries = JSON.parse(readFileSync(file, "utf8")) as { metadata?: Record<string, unknown> }[];
        writeFileSync(file, JSON.stringify(entries.map((e) => ({ ...e, metadata: { ...e.metadata, pinned: false } }))));
    },
    async run(editor) {
        await editor.waitForReady();
        await editor.capture("startup");

        // No network at startup: the first check is 10 s after it, in real time here.
        await editor.waitForText((t) => t.includes("Updated 2 extensions."), { timeoutMs: 60_000 });
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
