import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { npmMissing, writeBiomeProject } from "../../src/TestUtils/biomeFixture.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Stock Biome from the marketplace with the package in the project: a lint squiggle, Format Document through
// `editor.defaultFormatter`, the quick fix menu with suppressions and organize imports on save.

const projectRoot = join(tmpdir(), "diode-scenario-biome");
const sample = join(projectRoot, "sample.js");

export default defineScenario({
    name: "biome",
    title: "Biome from the marketplace: diagnostics, format with the default formatter, quick fix, organize on save",
    open: [projectRoot, sample],
    installVsix: ["biomejs.biome"],
    network: true,
    cols: 130,
    rows: 24,
    // Extension host scenarios run a subprocess: Linux only.
    skipOn: ["win32", "darwin"],
    requires: npmMissing,
    settings: {
        "[javascript]": { "editor.defaultFormatter": "biomejs.biome" },
        "editor.codeActionsOnSave": { "source.organizeImports.biome": "explicit" },
    },
    prepare() {
        rmSync(projectRoot, { recursive: true, force: true });
        writeBiomeProject(projectRoot);
        return Promise.resolve();
    },
    async run(editor) {
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
            { describe: "undercurl squiggle from the Biome server", timeoutMs: 60_000, intervalMs: 500 },
        );
        await editor.capture("diagnostics");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Format Document");
        await editor.waitForText((t) => t.includes("Format Document"), { timeoutMs: 20_000 });
        await editor.sendKey("Enter");
        // The frame draws an indent guide in the first column of the indent.
        await editor.waitForText((t) => t.includes("▏       debugger;"));
        await editor.capture("formatted");

        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+.");
        await editor.waitForText((t) => t.includes("Suppress rule lint/suspicious/noDebugger"), { timeoutMs: 20_000 });
        await editor.capture("quick-fix");
        await editor.sendKey("Escape");

        await editor.sendKey("Ctrl+s");
        await editor.waitForText((t) => t.includes('"./b.js"') && t.indexOf('"./b.js"') < t.indexOf('"./z.js"'));
        await editor.capture("organized-on-save");
    },
});
