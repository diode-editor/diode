import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// The stock typescript-language-server through vscode-languageclient: a `@deprecated` function comes with
// `CompletionItemTag.Deprecated` and is struck through; after `new` with a contextual class type tsserver marks the
// class `isRecommended`, the client turns it into `preselect`, and the popup opens on it rather than on its first row.

const require_ = createRequire(import.meta.url);
/** StyleFlags.Undercurl. */
const UNDERCURL = 8;

const sampleDir = mkdtempSync(join(tmpdir(), "diode-lsp-tags-demo-"));
const mainFile = join(sampleDir, "main.ts");

const SOURCE = `/** @deprecated use newFn */
export function oldFn(): void {}

export function otherFn(): void {}

class Widget {}

export { Widget };

// The squiggle under it tells the scenario the server is ready.
export const answer: number = "42";

`;

/** First cell of a popup row's label: the popup draws two spaces between the kind icon and the label. */
function popupLabel(frame: GridSnapshot, label: string): { x: number; y: number } | null {
    const cell = findTextCell(frame, `  ${label}  `);
    return cell === null ? null : { x: cell.x + 2, y: cell.y };
}

function cellAt(frame: GridSnapshot, at: { x: number; y: number }): GridSnapshot["cells"][number] {
    return frame.cells[at.y * frame.cols + at.x];
}

export default defineScenario({
    name: "lsp-completion-tags",
    title: "Stock typescript-language-server: a deprecated item is struck through, a preselect item is selected",
    open: [sampleDir, mainFile],
    settings: {
        "diode.lsp.typescript.serverPath": require_.resolve("typescript-language-server/lib/cli.mjs"),
        "diode.lsp.typescript.tsserverPath": require_.resolve("typescript/lib/tsserver.js"),
    },
    cols: 100,
    rows: 24,
    // Extension host + server spawn: Linux only.
    skipOn: ["win32", "darwin"],
    async prepare() {
        writeFileSync(mainFile, SOURCE);
        writeFileSync(join(sampleDir, "tsconfig.json"), '{ "compilerOptions": { "strict": true } }\n');
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("class Widget"));
        // Before the server answers, the provider is not registered and the popup shows buffer words, unstruck.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
            { describe: "tsserver undercurl squiggle (server ready)", timeoutMs: 120_000, intervalMs: 500 },
        );
        await editor.sendKey("Ctrl+End");

        // ── Deprecated: the label of oldFn is struck through ──
        for (const key of ["o", "l", "d"]) await editor.sendKey(key);
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => {
                const old = popupLabel(frame, "oldFn");
                return old !== null && (cellAt(frame, old).style & StyleFlags.Strikethrough) !== 0;
            },
            { describe: "oldFn struck through in the popup", timeoutMs: 60_000, intervalMs: 500 },
        );
        await editor.capture("deprecated");

        // ── Preselect: after `new` the popup opens on Widget, not on its first row ──
        await editor.sendKey("Escape");
        for (let i = 0; i < 3; i++) await editor.sendKey("Backspace");
        await editor.sendText("const w: Widget = new ");
        // Typing may leave a popup open; Ctrl+Space on an open popup toggles the details pane instead of asking.
        await editor.sendKey("Escape");
        await editor.sendKey("Ctrl+Space");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => {
                const widget = popupLabel(frame, "Widget");
                if (widget === null) return false;
                // The first row of the popup sits right under its top border.
                const first = findTextCell(frame, "╭");
                if (first === null || first.y + 1 === widget.y) return false;
                const firstRow = { x: widget.x, y: first.y + 1 };
                return cellAt(frame, widget).bg !== cellAt(frame, firstRow).bg;
            },
            { describe: "Widget selected below the first row", timeoutMs: 60_000, intervalMs: 500 },
        );
        await editor.capture("preselect");
    },
});
