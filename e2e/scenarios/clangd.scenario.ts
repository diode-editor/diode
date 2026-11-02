import { cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clangdMissing, CPP_SAMPLE_DIR } from "../../src/TestUtils/clangdFixture.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Stock clangd from the marketplace with the machine's clangd: a squiggle and inlay hints in main.cpp, Alt+O between
// the header and its source, the type hierarchy tree (Shift+Alt+T) and the AST view in Explorer.

const projectRoot = join(tmpdir(), "diode-scenario-clangd");

export default defineScenario({
    name: "clangd",
    title: "clangd from the marketplace: diagnostics, inlay hints, Alt+O, type hierarchy and AST",
    open: [projectRoot, join(projectRoot, "main.cpp")],
    installVsix: ["llvm-vs-code-extensions.vscode-clangd"],
    network: true,
    cols: 130,
    rows: 30,
    // Extension host scenarios run a subprocess: Linux only.
    skipOn: ["win32", "darwin"],
    requires: clangdMissing,
    prepare() {
        rmSync(projectRoot, { recursive: true, force: true });
        cpSync(CPP_SAMPLE_DIR, projectRoot, { recursive: true });
        return Promise.resolve();
    },
    async run(editor) {
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
            { describe: "undercurl squiggle from clangd", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.waitForText((t) => t.includes("Square square(side: 2.0);"), { timeoutMs: 30_000 });
        await editor.capture("diagnostics-and-inlay-hints");

        await editor.sendKey("Ctrl+p");
        await editor.waitForNode("#quickInput");
        await editor.sendText("shape.h");
        await editor.waitForText((t) => t.includes("shape.h"), { timeoutMs: 20_000 });
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("struct Square : Shape {"));
        await editor.sendKey("Alt+o");
        await editor.waitForText((t) => t.includes("double Square::area() const"), { timeoutMs: 20_000 });
        await editor.capture("alt-o-to-source");

        await editor.sendKey("Alt+o");
        await editor.waitForText((t) => t.includes("struct Square : Shape {"), { timeoutMs: 20_000 });
        await editor.sendKey("Ctrl+Home");
        for (let line = 0; line < 7; line++) await editor.sendKey("ArrowDown");
        for (let column = 0; column < 7; column++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Shift+Alt+t");
        // The subtype row under the root, on the tree's indent guide in the sidebar's first column.
        await editor.waitForText((t) => t.includes("TYPE HIERARCHY") && /^ │[^│\n]{0,6}Square/m.test(t), {
            timeoutMs: 20_000,
        });
        await editor.capture("type-hierarchy");

        await editor.sendKey("F1");
        await editor.waitForNode("#quickInput");
        await editor.sendText("clangd: Show AST");
        await editor.waitForText((t) => t.includes("Show AST"), { timeoutMs: 20_000 });
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("CXXRecord Square"), { timeoutMs: 20_000 });
        await editor.capture("ast");
    },
});
