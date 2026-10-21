/**
 * Hot render paths on cursor movement: caches keyed by versionId (and foldsVersion) make a
 * frame O(1) — without them navigating a 3500-line file cost ~44 ms/frame.
 */

import { DisplayLine } from "@tuidom/core/common/displayLine";
import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../common/core/iSelection.ts";
import { createInsertEdit } from "../common/core/iTextEdit.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";
import { LONG_LINE_TRUNCATION_BADGE_WIDTH, STOP_RENDERING_LINE_AFTER } from "../common/viewModel/longLineRendering.ts";

import { EditorElement } from "./editorElement.ts";

function generateJsonLikeText(lineCount: number): string {
    const lines: string[] = ["{"];
    let i = 1;
    while (lines.length < lineCount - 1) {
        const pkg = `pkg-${String(i).padStart(5, "0")}`;
        lines.push(`  "${pkg}": {`);
        lines.push(`    "version": "1.${i % 100}.${i % 10}",`);
        lines.push(`    "resolved": "https://registry.npmjs.org/${pkg}/-/${pkg}-1.${i % 100}.${i % 10}.tgz",`);
        lines.push(`    "integrity": "sha512-${"x".repeat(60)}="`);
        lines.push(`  },`);
        i++;
    }
    lines.push("}");
    return lines.join("\n");
}

// Realistic package-lock.json scale: ~3500 lines, ~120 KB.
const DOC_LINE_COUNT = 3_500;
const VIEWPORT_HEIGHT = 40;
const CURSOR_MOVES = 100;

describe("EditorElement / EditorViewState render-loop performance (cached)", () => {
    it("contentWidth: cached by versionId — 100 cursor-move frames must be fast", () => {
        const text = generateJsonLikeText(DOC_LINE_COUNT);
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const editor = new EditorElement(viewState);

        void editor.contentWidth;

        const t0 = performance.now();
        for (let move = 0; move < CURSOR_MOVES; move++) {
            void editor.contentWidth;
        }
        const ms = performance.now() - t0;

        console.log(
            `[cached] contentWidth ×${CURSOR_MOVES} on ${DOC_LINE_COUNT}-line doc: ${ms.toFixed(1)} ms` +
                ` (${(ms / CURSOR_MOVES).toFixed(2)} ms/frame)`,
        );

        expect(ms).toBeLessThan(300);
    }, 120_000);

    it("buildVisibleLines: cached by versionId — 100 render frames must be fast", () => {
        const text = generateJsonLikeText(DOC_LINE_COUNT);
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);

        const simulateOneFrame = (): void => {
            viewState.getViewLineCount();
            for (let screenY = 0; screenY < VIEWPORT_HEIGHT; screenY++) {
                const viewLine = screenY;
                viewState.visualToLogicalLine(viewLine);
                viewState.getViewLine(viewLine);
                viewState.getViewLineTokens(viewLine);
            }
            viewState.getViewLineCount();
        };

        simulateOneFrame();

        const t0 = performance.now();
        for (let move = 0; move < CURSOR_MOVES; move++) {
            simulateOneFrame();
        }
        const ms = performance.now() - t0;

        console.log(
            `[cached] buildVisibleLines ×${CURSOR_MOVES * (VIEWPORT_HEIGHT * 3 + 2)} on ${DOC_LINE_COUNT}-line doc: ${ms.toFixed(1)} ms` +
                ` (${(ms / CURSOR_MOVES).toFixed(2)} ms/frame)`,
        );

        expect(ms).toBeLessThan(20);
    }, 120_000);

    it("combined render frame: contentWidth + buildVisibleLines × 100 cursor moves — must be fast", () => {
        const text = generateJsonLikeText(DOC_LINE_COUNT);
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const editor = new EditorElement(viewState);

        const simulateFrame = (): void => {
            void editor.contentWidth;

            viewState.getViewLineCount();
            for (let screenY = 0; screenY < VIEWPORT_HEIGHT; screenY++) {
                viewState.visualToLogicalLine(screenY);
                viewState.getViewLine(screenY);
                viewState.getViewLineTokens(screenY);
            }
            viewState.getViewLineCount();
        };

        simulateFrame();

        const t0 = performance.now();
        for (let move = 0; move < CURSOR_MOVES; move++) {
            simulateFrame();
        }
        const ms = performance.now() - t0;

        console.log(
            `[cached] combined render frame ×${CURSOR_MOVES} on ${DOC_LINE_COUNT}-line doc: ${ms.toFixed(1)} ms` +
                ` (${(ms / CURSOR_MOVES).toFixed(2)} ms/frame)`,
        );

        expect(ms).toBeLessThan(300);
    }, 120_000);
});

// Long lines: `contentWidth` used to resegment the whole document on every
// versionId, and Output bumps it on every append — a 200k-char line cost
// ~72 ms per pass. The width cache is now incremental, and DisplayLine is capped at
// STOP_RENDERING_LINE_AFTER.

const EXTREME_LINE_LENGTH = 200_000;

describe("EditorElement — extremely long lines must not freeze", () => {
    function makeDocWithLongLine(): TextDocument {
        const lines: string[] = [];
        for (let i = 0; i < 200; i++) lines.push(`normal line ${i}`);
        lines.push("x".repeat(EXTREME_LINE_LENGTH));
        return new TextDocument(lines.join("\n"));
    }

    it("contentWidth stays cheap across appends that bump versionId", () => {
        const doc = makeDocWithLongLine();
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const editor = new EditorElement(viewState);

        void editor.contentWidth;

        const APPENDS = 200;
        const t0 = performance.now();
        for (let i = 0; i < APPENDS; i++) {
            const lastLine = doc.lineCount - 1;
            doc.applyEdits([createInsertEdit(lastLine, doc.getLineLength(lastLine), `\nlog record ${i}`)]);
            void editor.contentWidth;
        }
        const ms = performance.now() - t0;

        console.log(`[long-line] ${APPENDS} appends + contentWidth reads: ${ms.toFixed(1)} ms`);
        expect(ms).toBeLessThan(1_000);
    }, 120_000);

    it("first contentWidth on open is bounded by the cap, not the line length", () => {
        const doc = makeDocWithLongLine();
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const editor = new EditorElement(viewState);

        const t0 = performance.now();
        const width = editor.contentWidth;
        const ms = performance.now() - t0;

        console.log(`[long-line] first contentWidth on ${EXTREME_LINE_LENGTH}-char line: ${ms.toFixed(1)} ms`);
        expect(width).toBeLessThanOrEqual(STOP_RENDERING_LINE_AFTER + LONG_LINE_TRUNCATION_BADGE_WIDTH);
        expect(ms).toBeLessThan(100);
    }, 120_000);

    /**
     * The timing check is relative (capped vs uncapped on the same line):
     * an absolute ms budget was a flake on slow CI.
     */
    it("displayLineFor caps the visible long line", () => {
        const doc = makeDocWithLongLine();
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const longLine = doc.getLineContent(doc.lineCount - 1);
        const tabSize = viewState.tabSize;

        const dl = viewState.displayLineFor(longLine);
        expect(dl.isTruncated).toBe(true);
        expect(dl.slots.length).toBeLessThanOrEqual(10_000);

        const ITER = 10;
        const timeBatch = (build: () => void): number => {
            build();
            const t0 = performance.now();
            for (let i = 0; i < ITER; i++) build();
            return performance.now() - t0;
        };
        const capped = timeBatch(() => new DisplayLine(longLine, tabSize, STOP_RENDERING_LINE_AFTER));
        const uncapped = timeBatch(() => new DisplayLine(longLine, tabSize));

        console.log(
            `[long-line] ${ITER}× DisplayLine — capped ${capped.toFixed(1)} ms vs uncapped ${uncapped.toFixed(1)} ms`,
        );
        // The real ratio is ~20–35×; 3× leaves room for noise but still catches a broken cap.
        expect(capped * 3).toBeLessThan(uncapped);
    }, 120_000);
});
