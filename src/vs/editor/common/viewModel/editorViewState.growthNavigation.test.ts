import { describe, expect, it } from "vitest";

import { MemoryRandomAccessFile } from "../../../../TestUtils/memoryRandomAccessFile.ts";
import { createCursorSelection, createSelection } from "../core/iSelection.ts";
import { DiskTextBuffer } from "../model/diskTextBuffer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

/** The index grows by 10 lines per released read; the file reports twice its bytes until a read comes back empty. */
function growing(lines: number) {
    const text = Array.from({ length: lines }, (_, i) => `line ${String(i).padStart(4, "0")}`).join("\n") + "\n";
    const bytes = Buffer.from(text);
    const file = new MemoryRandomAccessFile(bytes, { size: bytes.length * 2, gated: true });
    const buffer = new DiskTextBuffer(file, { chunkSize: "line 0000\n".length * 10 });
    const indexed = new Promise<void>((resolve) => {
        buffer.onDidChangeIndexing(() => {
            if (buffer.indexing.done) resolve();
        });
    });
    buffer.startIndexing();
    const doc = new TextDocument(buffer);
    const viewState = new EditorViewState(doc);
    viewState.viewportHeight = 5;
    viewState.viewportWidth = 40;
    // Every growth moves the parked cursor; the throttle has its own test.
    viewState.growthFollowIntervalMs = 0;
    expect(doc.lineCount).toBe(10);
    return {
        doc,
        viewState,
        indexed,
        /** One more chunk of lines. */
        grow: async () => {
            file.release();
            await new Promise((resolve) => setImmediate(resolve));
        },
        finish: async () => {
            file.openGate();
            await indexed;
        },
    };
}

/**
 * Navigation while the index of a document on disk is being built (OpenPerformance 4.3): a target the index
 * has not reached is not a clamp to the middle of the file. The cursor waits on the provisional end and goes
 * on with each growth, to the target line or to the real end.
 */
describe("EditorViewState — Go to Line and Ctrl+End while the document grows", () => {
    it("Go to Line past the indexed end parks the cursor on the provisional end and finishes the jump when the line is in", async () => {
        const { doc, viewState, grow, finish } = growing(50);
        viewState.goToPosition(25, 3);
        expect(viewState.selections[0].active).toEqual({ line: 9, character: 3 });

        await grow();
        expect(doc.lineCount).toBe(20);
        expect(viewState.selections[0].active).toEqual({ line: 19, character: 3 });
        expect(viewState.scrollTop).toBeGreaterThan(0);

        await grow();
        expect(doc.lineCount).toBe(30);
        expect(viewState.selections[0].active).toEqual({ line: 25, character: 3 });
        expect(viewState.scrollTop).toBeLessThanOrEqual(25);
        expect(viewState.scrollTop + viewState.viewportHeight).toBeGreaterThan(25);

        // Reached: later growth leaves the cursor alone.
        await finish();
        expect(doc.lineCount).toBe(51);
        expect(viewState.selections[0].active).toEqual({ line: 25, character: 3 });
    });

    it("Ctrl+End keeps going to the end until the index is done, and the viewport follows", async () => {
        const { doc, viewState, grow, finish } = growing(50);
        viewState.cursorBottom();
        expect(viewState.selections[0].active.line).toBe(9);

        await grow();
        expect(viewState.selections[0].active.line).toBe(19);
        expect(viewState.scrollTop).toBe(20 - viewState.viewportHeight);

        await finish();
        expect(doc.lineCount).toBe(51);
        expect(viewState.selections[0].active).toEqual({ line: 50, character: 0 });
        expect(viewState.scrollTop).toBe(51 - viewState.viewportHeight);
    });

    it("a line past the real end: the cursor stays on the last line once the index is done", async () => {
        const { viewState, finish } = growing(30);
        viewState.goToPosition(1000, 0);
        await finish();
        expect(viewState.selections[0].active).toEqual({ line: 30, character: 0 });
    });

    it("a cursor the user moved off the parked spot drops the target", async () => {
        const { viewState, grow } = growing(50);
        viewState.goToPosition(45, 0);
        viewState.selections = [createCursorSelection(3, 2)];
        await grow();
        expect(viewState.selections[0].active).toEqual({ line: 3, character: 2 });
        await grow();
        expect(viewState.selections[0].active).toEqual({ line: 3, character: 2 });
    });

    it("a selection made from the parked spot, or a second cursor, drops the target too", async () => {
        const selected = growing(50);
        selected.viewState.goToPosition(45, 0);
        selected.viewState.selections = [createSelection(9, 0, 5, 0)];
        await selected.grow();
        expect(selected.viewState.selections[0]).toMatchObject({
            anchor: { line: 9, character: 0 },
            active: { line: 5, character: 0 },
        });

        const two = growing(50);
        two.viewState.goToPosition(45, 0);
        // The parked cursor stays where it was; the second one is the reason to drop the target.
        two.viewState.selections = [createCursorSelection(9, 0), createCursorSelection(9, 3)];
        await two.grow();
        expect(two.viewState.selections.map((sel) => sel.active.character)).toEqual([0, 3]);
        expect(two.viewState.selections.map((sel) => sel.active.line)).toEqual([9, 9]);
    });

    it("Shift+Ctrl+End extends the selection to the provisional end and does not follow", async () => {
        const { viewState, grow } = growing(50);
        viewState.selections = [createCursorSelection(2, 0)];
        viewState.cursorBottom(true);
        expect(viewState.selections[0]).toMatchObject({
            anchor: { line: 2, character: 0 },
            active: { line: 9, character: 9 },
        });
        await grow();
        expect(viewState.selections[0].active.line).toBe(9);
    });

    it("a jump inside the document, or a later one, replaces the target", async () => {
        const { viewState, grow } = growing(50);
        viewState.goToPosition(45, 0);
        viewState.goToPosition(4, 1);
        await grow();
        expect(viewState.selections[0].active).toEqual({ line: 4, character: 1 });

        viewState.goToPosition(45, 0);
        viewState.goToPosition(25, 0);
        await grow();
        expect(viewState.selections[0].active).toEqual({ line: 25, character: 0 });
    });

    it("a reload (flush) of the document drops the target: the reload's own cursor rules apply", async () => {
        const first = growing(50);
        first.viewState.goToPosition(45, 0);
        const second = growing(30);
        first.doc.setText(second.doc.onDisk!);
        expect(first.viewState.selections[0].active.line).toBe(9);
        await second.grow();
        // The target of the old document is gone: line 45 is past the new file's 30 lines and is never reached. The
        // cursor parked on the last line followed, though, and follow survives a reload (4.4): it rides the new end.
        expect(first.viewState.selections[0].active.line).toBe(19);
        await second.finish();
        expect(first.viewState.selections[0].active.line).toBe(30);
    });

    it("in memory a target past the end is clamped as before, and an edit does not move the cursor", () => {
        const doc = new TextDocument(Array.from({ length: 10 }, (_, i) => `line ${String(i)}`).join("\n"));
        const viewState = new EditorViewState(doc);
        viewState.viewportHeight = 5;
        viewState.goToPosition(99, 0);
        expect(viewState.selections[0].active).toEqual({ line: 9, character: 0 });
        doc.applyEdits([
            { range: { start: { line: 9, character: 6 }, end: { line: 9, character: 6 } }, text: "\nmore\nmore" },
        ]);
        expect(viewState.selections[0].active).toEqual({ line: 9, character: 0 });
    });

    it("a jump inside the document sets no target: growth does not pull the viewport back to the cursor", async () => {
        const inside = growing(50);
        inside.viewState.goToPosition(3, 0);
        inside.viewState.scrollTop = 5;
        await inside.grow();
        expect(inside.viewState.selections[0].active).toEqual({ line: 3, character: 0 });
        expect(inside.viewState.scrollTop).toBe(5);

        // The last line itself is inside the document too.
        const last = growing(50);
        last.viewState.goToPosition(9, 0);
        last.viewState.scrollTop = 0;
        await last.grow();
        expect(last.viewState.selections[0].active).toEqual({ line: 9, character: 0 });
        expect(last.viewState.scrollTop).toBe(0);
    });

    it("the parked cursor moves at most once per interval and on the growth that ends the index (QA 4.3)", async () => {
        const { doc, viewState, grow, finish } = growing(80);
        viewState.growthFollowIntervalMs = 60_000;
        let moves = 0;
        viewState.onDidChangeCursorPosition(() => moves++);
        viewState.cursorBottom();
        moves = 0;
        await grow();
        await grow();
        await grow();
        // Within the interval: the cursor waits where it was parked, nothing is sent.
        expect(moves).toBe(0);
        expect(viewState.selections[0].active.line).toBe(9);
        await finish();
        expect(doc.lineCount).toBe(81);
        expect(viewState.selections[0].active).toEqual({ line: 80, character: 0 });
        expect(moves).toBe(1);
    });

    it("a target on the line just past the new end is not reached yet: the cursor keeps waiting", async () => {
        const { doc, viewState, grow } = growing(80);
        viewState.growthFollowIntervalMs = 60_000;
        viewState.goToPosition(20, 0);
        await grow();
        expect(doc.lineCount).toBe(20);
        expect(viewState.selections[0].active).toEqual({ line: 9, character: 0 });
        await grow();
        expect(viewState.selections[0].active).toEqual({ line: 20, character: 0 });
    });

    it("a parked Go to Line moves at once when its line comes in, even inside the interval", async () => {
        const { viewState, grow } = growing(80);
        viewState.growthFollowIntervalMs = 60_000;
        viewState.goToPosition(15, 2);
        await grow();
        expect(viewState.selections[0].active).toEqual({ line: 15, character: 2 });
    });
});
