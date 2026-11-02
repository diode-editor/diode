import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

const require_ = createRequire(import.meta.url);

// Module names inside `require("`: the builtin TypeScript server lists the package.json dependencies, and typing
// past the opening quote narrows the popup by everything typed since it. The `@` case (npm-intellisense plus
// a tsserver retrigger) is covered by the unit tests and the marketplace smoke check.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-require-completion-"));
const jsFile = join(sampleDir, "a.js");

/** tsserver registers its provider only after `initialize`: until then the quote opens nothing. */
async function typeQuoteUntilModules(editor: ScenarioDriver): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt++) {
        await editor.sendKey('"');
        try {
            await editor.waitForText((t) => t.includes("left-pad"), { timeoutMs: 3000 });
            return;
        } catch {
            // The auto-closed pair goes away with one Backspace.
            await editor.sendKey("Backspace");
        }
    }
    throw new Error("tsserver never listed the package.json dependencies");
}

export default defineScenario({
    name: "require-completion",
    title: "Builtin TypeScript: package.json dependencies in require(), filtered as you type",
    open: [sampleDir, jsFile],
    // The server comes from the repo's devDeps, like `lsp-completion`.
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 20,
    // Extension host + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    prepare() {
        writeFileSync(
            join(sampleDir, "package.json"),
            JSON.stringify({ name: "sample", dependencies: { "left-pad": "1.3.0", "@types/foo": "1.0.0" } }),
        );
        writeFileSync(jsFile, "");
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForReady();
        await editor.sendText("const x = require(");
        await typeQuoteUntilModules(editor);
        for (const key of ["l", "e"]) await editor.sendKey(key);
        await editor.waitForText((t) => t.includes('require("le")') && t.includes("left-pad"));
        await editor.capture("filtered");
    },
});
