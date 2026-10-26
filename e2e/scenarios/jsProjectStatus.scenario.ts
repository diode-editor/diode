import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// As in VS Code: a .js file outside any project says "No jsconfig" in Language Status, "Configure JSConfig"
// writes jsconfig.json and opens it, and back in the .js file the status names the config.

const require_ = createRequire(import.meta.url);
// One level deeper than the temp dir: tsserver does not watch config files two levels below / (it takes
// `/tmp/<x>` for a home directory) and would never notice the new jsconfig.
const sampleDir = join(mkdtempSync(join(tmpdir(), "diode-js-project-status-demo-")), "proj");
const shapesFile = join(sampleDir, "src", "shapes.js");
const configFile = join(sampleDir, "jsconfig.json");
const SEGMENT = "#statusBarItem-status-languageStatus";

/** The picker shows the items as they were when it opened: reopen it until the status says `text`. */
async function openStatusWith(editor: ScenarioDriver, text: string, timeoutMs: number): Promise<void> {
    await waitUntil(
        async () => {
            await editor.clickNode(SEGMENT);
            const found = await editor.waitForText((t) => t.includes(text), { timeoutMs: 1000 }).then(
                () => true,
                () => false,
            );
            if (!found) await editor.sendKey("Escape");
            return found;
        },
        (found) => found,
        { describe: `the language status says "${text}"`, timeoutMs, intervalMs: 250 },
    );
}

export default defineScenario({
    name: "js-project-status",
    title: "JS project status: No jsconfig → Configure JSConfig → the status names jsconfig.json",
    open: [sampleDir, shapesFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host scenarios run a subprocess + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        mkdirSync(join(sampleDir, "src"), { recursive: true });
        writeFileSync(join(sampleDir, "package.json"), '{"type":"module"}\n');
        writeFileSync(shapesFile, "export class Circle {}\n\nexport class Square {}\n");
        writeFileSync(join(sampleDir, "src", "main.js"), 'import { Circle, Square } from "./shapes.js";\n');
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("export class Circle"));
        // The item says "Loading IntelliSense status" until the server answers projectInfo.
        await editor.waitForNode(SEGMENT, { timeoutMs: 60_000 });
        await openStatusWith(editor, "Configure JSConfig", 60_000);
        await editor.capture("no-jsconfig");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('"compilerOptions"') && t.includes('"checkJs": false'));
        await waitUntil(
            () => Promise.resolve(existsSync(configFile)),
            (exists) => exists,
            { describe: "jsconfig.json on disk", timeoutMs: 5000, intervalMs: 100 },
        );
        await editor.capture("jsconfig-created");

        // Back to shapes.js, the tab left of jsconfig.json.
        await editor.sendKey("Ctrl+PageUp");
        await editor.waitForText((t) => t.includes("export class Circle"));
        // tsserver notices the new config by polling it; the status follows on its own.
        await openStatusWith(editor, "Open Config File", 30_000);
        await editor.capture("jsconfig-status");
        await editor.sendKey("Escape");
    },
});
