import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// "Extensions: Install from VSIX..." (#1134): a terminal has no file dialog, so the path is typed in a quick input;
// the vsix installs the way `--install-extension` does and the notification offers a reload. Extensions call the same
// install through `workbench.extensions.command.installFromVSIX` (CodeLLDB, for its platform package).

const vsix = join(mkdtempSync(join(tmpdir(), "diode-install-vsix-")), "sample-lang-0.0.1.vsix");

export default defineScenario({
    name: "install-from-vsix",
    title: "Extensions: Install from VSIX... — path in a quick input, then Reload Now",
    open: [resolve(repoRoot, "e2e", "fixtures", "sample.ts")],
    cols: 120,
    rows: 24,
    prepare() {
        const packed = spawnSync(
            process.execPath,
            [
                resolve(repoRoot, "scripts", "pack-vsix.mjs"),
                resolve(repoRoot, "e2e", "marketplace", "sample-extension"),
                vsix,
            ],
            { encoding: "utf8" },
        );
        if (packed.status !== 0) throw new Error(`pack-vsix failed: ${packed.stderr}`);
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("Extensions: Install from VSIX");
        await editor.waitForText((t) => t.includes("Install from VSIX..."));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Path to a .vsix file"));
        await editor.sendText(vsix);
        await editor.capture("path");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Completed installing extension."));
        await editor.capture("installed");
    },
});
