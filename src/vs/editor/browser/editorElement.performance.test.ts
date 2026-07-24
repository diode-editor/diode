/**
 * Performance tests for EditorElement / EditorViewState render-loop hot paths.
 *
 * Both operations are now cached by document versionId so cursor navigation
 * (which does not change versionId) costs O(1) instead of O(n) per frame.
 *
 *   1. EditorElement.contentWidth — cached by versionId; O(n × Intl.Segmenter)
 *      only on the first call after a content change, O(1) thereafter.
 *
 *   2. EditorViewState.buildVisibleLines() — cached by versionId + foldsVersion;
 *      O(n) only when content or fold state changes, O(1) for all render reads.
 *
 * Observed real-world impact of the fix: navigating a 3500-line file drops from
 * ~44 ms/frame (contentWidth alone) to effectively 0 ms for cursor moves.
 */

import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../common/core/iSelection.ts";
import { createInsertEdit } from "../common/core/iTextEdit.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

// ─── Helpers ────────────────────────────────────────────────

/**
 * Generates JSON-like content representative of a lockfile.
 * Each entry ≈ 2 lines of JSON, total ~lineCount lines with typical
 * key/value structure and varied line lengths.
 */
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

// ─── Constants ──────────────────────────────────────────────

// Realistic package-lock.json scale: ~3500 lines, ~120 KB.
const DOC_LINE_COUNT = 3_500;
const VIEWPORT_HEIGHT = 40;
// Number of simulated "cursor movements" (each triggers one render frame).
const CURSOR_MOVES = 100;

// ─── Tests ──────────────────────────────────────────────────

describe("EditorElement / EditorViewState render-loop performance (cached)", () => {
    /**
     * Bottleneck 1: EditorElement.contentWidth
     *
     * The implementation iterates ALL document lines to find the maximum display
     * width, creating a new DisplayLine (via Intl.Segmenter) for each line.
     * This exact loop is the contentWidth getter in EditorElement.ts.
     *
     * Called every render frame (by ScrollBarDecorator / layout system).
     * PASSES when slow (> 3000 ms for 100 frames). Fix target: < 100 ms.
     */
    it("contentWidth: cached by versionId — 100 cursor-move frames must be fast", () => {
        const text = generateJsonLikeText(DOC_LINE_COUNT);
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const editor = new EditorElement(viewState);

        // Warm up JIT + first cache population
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

        // Cache hit on every frame (versionId unchanged by cursor moves).
        // 100 frames on a 3500-line doc should complete in well under 300 ms.
        expect(ms).toBeLessThan(300);
    }, 120_000);

    /**
     * Bottleneck 2: EditorViewState.buildVisibleLines() called for every visible line
     *
     * During render, visualToLogicalLine() is called ~3 times per visible line
     * (gutter draw, getViewLine, getViewLineTokens). Each call runs buildVisibleLines()
     * which allocates and fills a number[] of ALL document lines.
     *
     * For a 40-line viewport: ~120 buildVisibleLines() calls per render frame.
     * For a 3500-line document: ~120 × 3500 = 420 000 loop iterations per frame.
     *
     * PASSES when slow (> 300 ms for 100 frames). Fix target: < 10 ms.
     */
    it("buildVisibleLines: cached by versionId — 100 render frames must be fast", () => {
        const text = generateJsonLikeText(DOC_LINE_COUNT);
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);

        // Replicate the call pattern during a single render frame:
        // - 3 calls per visible line (visualToLogicalLine is called 3× in render loop)
        // - plus getViewLineCount() calls from layout
        const simulateOneFrame = (): void => {
            viewState.getViewLineCount(); // layout call
            for (let screenY = 0; screenY < VIEWPORT_HEIGHT; screenY++) {
                const viewLine = screenY; // scrollTop = 0 for simplicity
                viewState.visualToLogicalLine(viewLine); // gutter
                viewState.getViewLine(viewLine); // content
                viewState.getViewLineTokens(viewLine); // tokens
            }
            viewState.getViewLineCount(); // scrollbar layout
        };

        // Warm up JIT
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

        // Cache hit on every frame (versionId and foldsVersion unchanged by cursor moves).
        // 12 200 calls on a 3500-line doc should complete in well under 20 ms.
        expect(ms).toBeLessThan(20);
    }, 120_000);

    /**
     * Combined: both bottlenecks together, simulating a realistic render frame.
     *
     * This test measures the combined cost the user experiences as cursor lag:
     * contentWidth (Intl.Segmenter × n) + buildVisibleLines (array × 120 × n).
     *
     * PASSES when slow (> 3000 ms for 100 moves). Fix target: < 100 ms.
     */
    it("combined render frame: contentWidth + buildVisibleLines × 100 cursor moves — must be fast", () => {
        const text = generateJsonLikeText(DOC_LINE_COUNT);
        const doc = new TextDocument(text);
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const editor = new EditorElement(viewState);

        const simulateFrame = (): void => {
            // --- Layout: contentWidth (called by ScrollBarDecorator) ---
            void editor.contentWidth;

            // --- Render: visualToLogicalLine × 3 per visible line ---
            viewState.getViewLineCount();
            for (let screenY = 0; screenY < VIEWPORT_HEIGHT; screenY++) {
                viewState.visualToLogicalLine(screenY);
                viewState.getViewLine(screenY);
                viewState.getViewLineTokens(screenY);
            }
            viewState.getViewLineCount();
        };

        // Warm up
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

        // Both caches hit on every cursor-move frame.
        // 100 frames on a 3500-line doc should complete in well under 300 ms.
        expect(ms).toBeLessThan(300);
    }, 120_000);
});

// ─── Extremely long lines ───────────────────────────────────
//
// The regression that froze the editor: `contentWidth` re-segmented the whole
// document (a `new DisplayLine` per line) on every versionId bump, and the
// render loop built a full-line DisplayLine per visible line. One 200 k-char
// line cost ~72 ms per pass — and the Output panel bumps versionId on every
// appended record, so active RPC tracing meant a full rescan per log line.
//
// After the fix: `contentWidth` is an incremental per-line width cache and the
// render/caret paths cap the DisplayLine at STOP_RENDERING_LINE_AFTER. Cost is
// O(cap), not O(line length), and an append re-measures only the changed lines.

const EXTREME_LINE_LENGTH = 200_000;

describe("EditorElement — extremely long lines must not freeze", () => {
    function makeDocWithLongLine(): TextDocument {
        const lines: string[] = [];
        for (let i = 0; i < 200; i++) lines.push(`normal line ${i}`);
        lines.push("x".repeat(EXTREME_LINE_LENGTH));
        return new TextDocument(lines.join("\n"));
    }

    /**
     * The Output-panel freeze, reproduced: append 200 records to a document that
     * already holds one 200 k-char line, reading `contentWidth` after each append
     * exactly as the horizontal scrollbar does every layout. Each append bumps
     * versionId. The OLD code re-segmented the 200 k line every time (~72 ms × 200
     * ≈ 14 s); the incremental cache re-measures only the two changed lines.
     */
    it("contentWidth stays cheap across appends that bump versionId", () => {
        const doc = makeDocWithLongLine();
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const editor = new EditorElement(viewState);

        void editor.contentWidth; // warm up + prime the cache

        const APPENDS = 200;
        const t0 = performance.now();
        for (let i = 0; i < APPENDS; i++) {
            const lastLine = doc.lineCount - 1;
            doc.applyEdits([createInsertEdit(lastLine, doc.getLineLength(lastLine), `\nlog record ${i}`)]);
            void editor.contentWidth; // scrollbar layout read
        }
        const ms = performance.now() - t0;

        console.log(`[long-line] ${APPENDS} appends + contentWidth reads: ${ms.toFixed(1)} ms`);
        // Comfortably under a second; the old whole-document rescan took seconds.
        expect(ms).toBeLessThan(1_000);
    }, 120_000);

    /**
     * The first `contentWidth` after opening a file whose single line is 200 k
     * chars. The cap bounds the scan to STOP_RENDERING_LINE_AFTER.
     */
    it("first contentWidth on open is bounded by the cap, not the line length", () => {
        const doc = makeDocWithLongLine();
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const editor = new EditorElement(viewState);

        const t0 = performance.now();
        const width = editor.contentWidth;
        const ms = performance.now() - t0;

        console.log(`[long-line] first contentWidth on ${EXTREME_LINE_LENGTH}-char line: ${ms.toFixed(1)} ms`);
        // Width is capped, and the scan cost is bounded well under 100 ms.
        expect(width).toBeLessThanOrEqual(10_000);
        expect(ms).toBeLessThan(100);
    }, 120_000);

    /**
     * Building the visible line's DisplayLine (what the render loop does each
     * frame) must be O(cap) on the extreme line, not O(200 000). The slot array
     * is capped, and a batch of rebuilds (scroll/keypress re-renders while the
     * giant line is on screen) stays bounded. Uncapped, each build re-segments
     * 200 k chars (~40 ms → seconds for the batch); capped it is ~2 ms.
     */
    it("displayLineFor caps the visible long line", () => {
        const doc = makeDocWithLongLine();
        const viewState = new EditorViewState(doc, [createCursorSelection(0, 0)]);
        const longLine = doc.getLineContent(doc.lineCount - 1);

        const dl = viewState.displayLineFor(longLine);
        expect(dl.isTruncated).toBe(true);
        // Slot count is bounded by the cap, not the 200 000-char line length.
        expect(dl.slots.length).toBeLessThanOrEqual(10_000);

        const REBUILDS = 100;
        const t0 = performance.now();
        for (let i = 0; i < REBUILDS; i++) {
            viewState.displayLineFor(longLine);
        }
        const ms = performance.now() - t0;

        console.log(`[long-line] ${REBUILDS} displayLineFor rebuilds: ${ms.toFixed(1)} ms`);
        // Capped builds cost ~2 ms each; uncapped 200 k-char builds would take
        // seconds for the batch. A 1.5 s ceiling separates the two decisively.
        expect(ms).toBeLessThan(1_500);
    }, 120_000);
});
