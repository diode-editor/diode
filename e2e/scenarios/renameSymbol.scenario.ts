import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Rename provider edits go through a bulk workspace edit (#370): they reach the CLOSED file too, as one undo
// step. The directory is filled in prepare: rename writes to disk, and the committed fixture must stay clean.

const require_ = createRequire(import.meta.url);
const sampleDir = mkdtempSync(join(tmpdir(), "diode-rename-demo-"));
const defsFile = join(sampleDir, "defs.ts");
const closedFile = join(sampleDir, "main.ts");

/** `greet` is declared in defs.ts and called from the closed main.ts — rename must touch both. */
const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply = greet("world");\n\nexport { reply };\n';

export default defineScenario({
    name: "rename-symbol",
    title: "Rename Symbol (F2): stock tsserver edits both the open AND the closed file",
    open: [sampleDir, defsFile],
    // The server comes from the repo's devDeps (the built-in one: docs/arch/Extensions.md, "Builtin LSP client"
    // section), its path is passed via settings; tsserver.js is for sandboxes without their own TypeScript.
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // After References, only a command can return focus to the editor (it has no default keybinding, as in
    // VS Code); the letter avoids the menu bar mnemonics (F/E/S/V/G/H).
    userKeybindings: [{ key: "alt+q", command: "workbench.action.focusActiveEditorGroup" }],
    // Extension host scenarios run a subprocess + a spawned server — Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(join(sampleDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }, null, 2));
        writeFileSync(defsFile, DEFS_TS);
        writeFileSync(closedFile, MAIN_TS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("export function greet"));
        await editor.capture("before");

        // Onto the name in the declaration (line 0, column 18).
        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < 18; i++) await editor.sendKey("ArrowRight");

        // A cold tsserver answers from the single open file, and rename would miss the closed consumer.
        // Readiness is a main.ts reference in REFERENCES; keep pressing until it shows: an empty answer opens no panel.
        await waitUntil(
            async () => {
                await editor.sendKey("Ctrl+K");
                await editor.sendKey("Ctrl+R");
                return editor.captureFrame();
            },
            (frame) => {
                const text = frame.cells
                    .map((cell) => cell.char)
                    .join("");
                return text.includes("REFERENCES") && text.includes("const reply = greet");
            },
            { describe: "closed main.ts reference in the REFERENCES panel", timeoutMs: 120_000, intervalMs: 2000 },
        );
        await editor.capture("references");

        // Focus back to the editor — F2 is gated on `textInputFocus`.
        await editor.sendKey("Alt+q");
        await waitUntil(
            async () => {
                await editor.sendKey("F2");
                return editor.captureFrame();
            },
            (frame) =>
                frame.cells
                    .map((cell) => cell.char)
                    .join("")
                    .includes("Rename Symbol"),
            { describe: "Rename Symbol overlay", timeoutMs: 60_000, intervalMs: 2000 },
        );
        await editor.waitForText((t) => t.includes("greet"));
        await editor.capture("prompt");

        // The old name is not selected — erase it and type the new one.
        for (let i = 0; i < "greet".length; i++) await editor.sendKey("Backspace");
        await editor.sendText("welcome");
        await editor.sendKey("Enter");

        await waitUntil(
            () => Promise.resolve(readFileSync(closedFile, "utf8")),
            (text) => text.includes("import { welcome }") && text.includes('welcome("world")'),
            {
                describe: "import and call renamed in the closed main.ts",
                timeoutMs: 60_000,
                intervalMs: 250,
                diagnose: (last) => `main.ts now:\n${String(last)}`,
            },
        );
        // …and the open tab too.
        await editor.waitForText((t) => t.includes("export function welcome"), { timeoutMs: 30_000 });
        await editor.capture("after");

        // The whole rename is ONE undo step (bulk edit): Ctrl+Z restores the old name.
        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((t) => t.includes("export function greet"), { timeoutMs: 30_000 });
        await editor.capture("undo");
    },
});
