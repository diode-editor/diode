import { resolve } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Title `%key%`s resolve from `package.nls.json` and `category` becomes a prefix; commands without a category get
// no prefix, hence the query `Java: ` rather than `java`. The extension never activates (there is no java file):
// titles come from the `onCommand:` stubs, so the scenario takes minutes rather than a quarter hour of jdt.ls.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "extensionNls.txt");

export default defineScenario({
    name: "extension-nls",
    title: "NLS манифеста: человеческие имена команд стокового redhat.java в палитре",
    open: [sampleFile],
    installVsix: ["redhat.java"],
    network: true,
    // Otherwise the telemetry consent toast covers the frame; there is no activation, but the setting is cheaper
    // than a flake.
    settings: { "redhat.telemetry.enabled": false },
    // The case includes downloading the 139 MB platform vsix.
    timeoutMs: 600_000,
    cols: 110,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Ни строчки Java"), { timeoutMs: 60_000 });

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput", { timeoutMs: 30_000 });
        // `Java: ` appears only in the label built from category and title.
        await editor.sendText("Java: ");

        const frame = await editor.waitForText((t) => t.includes("Java: Switch to Standard Mode"), {
            timeoutMs: 60_000,
        });
        if (frameToText(frame).includes("%java.")) {
            throw new Error("extension-nls: в палитре остался nls-ключ вместо заголовка");
        }
        await editor.capture("command-palette");
    },
});
