import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// A file renamed in the explorer: `onWillRenameFiles` reaches the stock language client, the server answers
// `workspace/willRenameFiles`, and the import in the open file follows. Ctrl+Z from that tab undoes both, as one step.

const require_ = createRequire(import.meta.url);
const sampleDir = mkdtempSync(join(tmpdir(), "diode-rename-imports-demo-"));
const UNDERCURL = 8;
const OLD_NAME = "helper.ts";
const NEW_NAME = "greeter.ts";
mkdirSync(join(sampleDir, "src"));
const mainFile = join(sampleDir, "src", "main.ts");
writeFileSync(mainFile, 'import { greet } from "./helper";\n\ngreet(1);\n');
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

        // The squiggle under the bad call means the server has the project. Not a repeated F12: before that the server
        // answers with the import line, and F12 on a target under the caret opens References instead of jumping.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from tsserver", timeoutMs: 60000, intervalMs: 500 },
        );

        await clickOn(OLD_NAME);
        await editor.sendKey("F2");
        await editor.waitForText((t) => t.includes("Rename") && t.includes(OLD_NAME));
        for (let i = 0; i < OLD_NAME.length; i++) await editor.sendKey("Backspace");
        await editor.sendText(NEW_NAME);
        await editor.waitForText((t) => t.includes("Rename") && t.includes(NEW_NAME));
        await editor.sendKey("Enter");

        // Clicking the tree row opened the renamed file; the import is in the other tab.
        await editor.waitForText((t) => t.includes(NEW_NAME) && !t.includes(OLD_NAME), { timeoutMs: 30000 });
        await clickOn("main.ts");
        await editor.waitForText((t) => t.includes('"./greeter"'), { timeoutMs: 30000 });
        await editor.capture("renamed");

        await clickOn("greet(1);");
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes('"./helper"') && t.includes(OLD_NAME) && !t.includes(NEW_NAME), {
            timeoutMs: 20000,
        });
        await editor.capture("undone");
    },
});
