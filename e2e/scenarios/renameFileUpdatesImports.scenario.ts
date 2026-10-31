import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findTextCell, frameToText } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// A file renamed in the explorer: `onWillRenameFiles` reaches the stock language client, the server answers
// `workspace/willRenameFiles`, and the import in the open file follows. Ctrl+Z from that tab undoes both, as one step.

const require_ = createRequire(import.meta.url);
const sampleDir = mkdtempSync(join(tmpdir(), "diode-rename-imports-demo-"));
const OLD_NAME = "helper.ts";
const NEW_NAME = "greeter.ts";
mkdirSync(join(sampleDir, "src"));
const mainFile = join(sampleDir, "src", "main.ts");
writeFileSync(mainFile, 'import { greet } from "./helper";\n\ngreet();\n');
writeFileSync(join(sampleDir, "src", OLD_NAME), "export function greet(): void {}\n");
writeFileSync(
    join(sampleDir, "tsconfig.json"),
    '{ "compilerOptions": { "module": "esnext", "moduleResolution": "bundler" }, "include": ["src"] }\n',
);

export default defineScenario({
    name: "rename-file-updates-imports",
    title: "A file renamed in the explorer: the language server updates the import in the same undo step",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 20,
    // The language server runs in the extension host subprocess, flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        const clickOn = async (needle: string): Promise<void> => {
            const cell = findTextCell(await editor.captureFrame(), needle);
            if (cell === null) throw new Error(`"${needle}" is not on the screen`);
            await editor.click(cell.x + 1, cell.y);
        };
        await editor.waitForText((t) => t.includes('"./helper"') && t.includes("TypeScript"), { timeoutMs: 30000 });
        await editor.capture("before");

        // A definition answered means the client is up and the server has the project; an empty answer changes nothing.
        await clickOn("greet();");
        await waitUntil(
            async () => {
                await editor.sendKey("F12");
                return editor.captureFrame();
            },
            (frame) => frameToText(frame).includes("export function greet"),
            { timeoutMs: 60000 },
        );
        await clickOn("main.ts");
        await editor.waitForText((t) => t.includes('"./helper"'));

        await clickOn(`  ${OLD_NAME}`);
        await editor.sendKey("F2");
        await editor.waitForText((t) => t.includes("Rename") && t.includes(OLD_NAME));
        for (let i = 0; i < OLD_NAME.length; i++) await editor.sendKey("Backspace");
        await editor.sendText(NEW_NAME);
        await editor.waitForText((t) => t.includes("Rename") && t.includes(NEW_NAME));
        await editor.sendKey("Enter");

        await editor.waitForText((t) => t.includes('"./greeter"') && t.includes(NEW_NAME), { timeoutMs: 30000 });
        await editor.capture("renamed");

        await clickOn("greet();");
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes('"./helper"') && t.includes(OLD_NAME) && !t.includes(NEW_NAME), {
            timeoutMs: 20000,
        });
        await editor.capture("undone");
    },
});
