import { createRequire } from "node:module";
import { resolve } from "node:path";

import { frameLine } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

const require_ = createRequire(import.meta.url);
const sampleDir = resolve(repoRoot, "e2e", "fixtures", "lspSample");
const mainFile = resolve(sampleDir, "main.ts");

/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

export default defineScenario({
    name: "typescript-navigation",
    title: "Built-in TypeScript: Implementations with two classes and with one, callers of a function, a linked JSX tag",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
        "editor.linkedEditing": true,
        // Occurrences of `div` paint both tags too: off, the color of the tags is the linked ranges only.
        "editor.occurrencesHighlight": "off",
    },
    cols: 100,
    rows: 24,
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("const reply"));

        // The squiggle in main.ts says tsserver has loaded the project.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "undercurl squiggle from tsserver", timeoutMs: 120_000, intervalMs: 500 },
        );

        const openFile = async (name: string, marker: string): Promise<void> => {
            await editor.sendKey("Ctrl+P");
            await editor.waitForNode("#quickInput");
            await editor.sendText(name);
            await editor.waitForText((t) => t.includes(name));
            await editor.sendKey("Enter");
            await editor.waitForText((t) => t.includes(marker));
        };

        // `area` of the interface: two classes, the panel.
        await openFile("shapes.ts", "export interface Shape");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+F12");
        await editor.waitForText((t) => t.includes("Implementations") && t.includes("2 results in 1 file"), {
            timeoutMs: 60_000,
        });
        await editor.capture("implementations");

        // `only` of the interface: one class, a plain jump to line 6.
        await openFile("navigation.ts", "export interface Solo");
        await editor.sendKey("ArrowDown");
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Ctrl+F12");
        await editor.waitForText((t) => t.includes("Ln 6, Col 5"), { timeoutMs: 60_000 });
        await editor.capture("one-implementation");

        // `render` (line 9, after `function `): two callers.
        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("Home");
        for (let i = 0; i < "function ".length; i++) await editor.sendKey("ArrowRight");
        await editor.sendKey("Shift+Alt+h");
        await editor.waitForText((t) => t.includes("Callers Of") && t.includes("paint") && t.includes("update"), {
            timeoutMs: 60_000,
        });
        await editor.capture("callers");

        // A letter in the opening tag lands in the closing one too.
        await openFile("tag.tsx", "export const tag");
        await editor.sendKey("Ctrl+End");
        await editor.sendKey("ArrowUp");
        for (let i = 0; i < "export const tag = <d".length; i++) await editor.sendKey("ArrowRight");
        // Typing before the ranges arrive edits one tag: the caret walks until both tags have the color.
        await waitUntil(
            async () => {
                const frame = await editor.captureFrame();
                for (let y = 0; y < frame.rows; y++) {
                    const x = frameLine(frame, y).indexOf("<div></div>");
                    if (x < 0) continue;
                    const [plain, open, close] = [0, 1, 7].map(
                        (offset) => frame.cells[y * frame.cols + x + offset]?.bg,
                    );
                    if (open !== plain && close === open) return true;
                }
                await editor.sendKey("ArrowRight");
                await editor.sendKey("ArrowLeft");
                return false;
            },
            (linked) => linked,
            { describe: "the linked tag ranges", timeoutMs: 60_000, intervalMs: 100 },
        );
        await editor.sendText("x");
        await editor.waitForText((t) => t.includes("<dxiv></dxiv>"), { timeoutMs: 60_000 });
        await editor.capture("linked-tag");
    },
});
