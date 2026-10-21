import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, type ScenarioDriver } from "./framework.ts";

// As in VS Code: the server pre-creates the new file empty, and the diode-lsp-typescript client rewrites that into
// a create, so Ctrl+Z removes the file from disk; the step is in the history of every affected file.

const require_ = createRequire(import.meta.url);
const sampleDir = mkdtempSync(join(tmpdir(), "diode-move-undo-demo-"));
const srcDir = join(sampleDir, "src");
const sourceFile = join(srcDir, "a.ts");
const newFile = join(srcDir, "Foo.ts");

const A_TS = "export class Foo {\n    x = 1;\n}\n\nexport class Bar {\n    y = new Foo();\n}\n";

/** Via the tree, not Quick Open: the file index picks up a just-created file with a delay. */
async function openFoo(editor: ScenarioDriver): Promise<void> {
    const tree = await editor.waitForNode("TreeViewElement");
    await editor.waitForText((t) => t.includes("Foo.ts"));
    const frame = await editor.captureFrame();
    const row = Array.from({ length: tree.box.height }, (_, i) => tree.box.y + i).find((y) =>
        frame.cells
            .slice(y * frame.cols + tree.box.x, y * frame.cols + tree.box.x + tree.box.width)
            .map((cell) => cell.char || " ")
            .join("")
            .includes("Foo.ts"),
    );
    if (row === undefined) throw new Error("Foo.ts is not in the explorer tree");
    await editor.click(tree.box.x + 5, row);
    await editor.sendKey("Enter");
    await editor.waitForText((t) => t.includes("Foo.ts") && t.includes("x = 1"));
    // Focus the editor: Ctrl+Z in the tree would go to the explorer's undo.
    const text = await editor.waitForNode("EditorElement");
    await editor.click(text.box.x + 10, text.box.y);
}

export default defineScenario({
    name: "move-to-new-file-undo",
    title: "Move to a new file: Ctrl+Z from any affected tab removes the new file",
    open: [sampleDir, sourceFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    // An F-key: a legacy terminal can't tell upstream's Ctrl+Shift+R from Ctrl+R.
    userKeybindings: [{ key: "f6", command: "editor.action.refactor" }],
    cols: 100,
    rows: 24,
    // Extension host scenarios run a subprocess + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(sampleDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }, null, 2));
        writeFileSync(sourceFile, A_TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("export class Foo {"));

        // Onto the class name `Foo` (column 14).
        for (let i = 0; i < 14; i++) await editor.sendKey("ArrowRight");
        // The refactor provider answers only once the server is up, so retry.
        const deadline = Date.now() + 120_000;
        for (;;) {
            await editor.sendKey("F6");
            try {
                await editor.waitForText((t) => t.includes("Move to a new file"), { timeoutMs: 3_000 });
                break;
            } catch (error) {
                if (Date.now() > deadline) throw error;
                await editor.sendKey("Escape");
            }
        }
        await editor.sendText("Move to a new");
        await editor.sendKey("Enter");

        await waitUntil(
            () => Promise.resolve(existsSync(newFile) ? readFileSync(newFile, "utf8") : ""),
            (text) => text.includes("export class Foo"),
            { describe: "class Foo in the new file on disk", timeoutMs: 60_000, intervalMs: 250 },
        );
        await waitUntil(
            () => Promise.resolve(readFileSync(sourceFile, "utf8")),
            (text) => text.startsWith('import { Foo } from "./Foo";') && !text.includes("x = 1"),
            { describe: "source saved without class Foo", timeoutMs: 30_000, intervalMs: 250 },
        );
        await editor.waitForText((t) => t.includes("a.ts ×"));
        await editor.capture("moved");

        // The new file is opened AFTER the edit, and the step still lands in its history.
        await openFoo(editor);

        // A clean tab of a deleted file closes, as in upstream.
        await editor.sendKey("Ctrl+Z");
        await waitUntil(
            () => Promise.resolve(existsSync(newFile)),
            (exists) => !exists,
            { describe: "new file removed by undo", timeoutMs: 30_000, intervalMs: 250 },
        );
        await editor.waitForText(
            (t) => !t.includes("Foo.ts ×") && t.includes("export class Foo {") && t.includes("export class Bar {"),
        );
        await editor.capture("undone");

        await editor.sendKey("Ctrl+Y");
        await waitUntil(
            () => Promise.resolve(existsSync(newFile)),
            (exists) => exists,
            { describe: "new file restored by redo", timeoutMs: 30_000, intervalMs: 250 },
        );
        await openFoo(editor);
        await editor.sendText("// note\n");
        await editor.waitForText((t) => t.includes("// note"));
        await editor.sendKey("Ctrl+PageUp");
        await editor.waitForText((t) => t.includes('import { Foo } from "./Foo";'));
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("Could not undo"), { timeoutMs: 10_000 });
        await editor.capture("refused");
        if (!existsSync(newFile)) throw new Error("a refused undo must not touch the new file");
    },
});
