import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// Stock Error Lens on its defaults: the error line and the message take the colors the extension declares in
// `contributes.colors` (`errorLens.errorBackground`, `errorLens.errorForeground`); a switch to a light theme
// repaints them with the manifest's `light` defaults.

const require_ = createRequire(import.meta.url);
const sampleDir = mkdtempSync(join(tmpdir(), "diode-errorlens-colors-"));
const tsFile = join(sampleDir, "errors.ts");

const TS = `const answer: number = "forty-two";
const label: string = 42;
export { answer, label };
`;

export default defineScenario({
    name: "errorlens-colors",
    title: "Extension colors: Error Lens paints errors with its contributes.colors, light theme on the fly",
    open: [sampleDir, tsFile],
    installVsix: ["usernamehw.errorlens"],
    network: true,
    cols: 110,
    rows: 16,
    // Extension host scenarios run a subprocess: Linux only.
    skipOn: ["win32", "darwin"],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    userKeybindings: [{ key: "f8", command: "workbench.action.selectTheme" }],
    prepare() {
        writeFileSync(tsFile, TS);
        writeFileSync(join(sampleDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
        return Promise.resolve();
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("Type 'number' is not assignable"), {
            timeoutMs: 120_000,
            intervalMs: 500,
        });
        await editor.capture("dark");

        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Select Color Theme"));
        await editor.sendText("Light Modern");
        await editor.waitForText((t) => t.includes("Light Modern"));
        await editor.sendKey("Enter");
        await editor.waitForText((t) => !t.includes("Select Color Theme"));
        await editor.capture("light");
    },
});
