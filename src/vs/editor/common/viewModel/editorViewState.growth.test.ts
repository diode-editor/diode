import { describe, expect, it } from "vitest";

import { MemoryRandomAccessFile } from "../../../../TestUtils/memoryRandomAccessFile.ts";
import { createRange } from "../core/iRange.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { DiskTextBuffer } from "../model/diskTextBuffer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

/** A buffer on disk whose index grows under the view: the file reports more bytes than it has, the pass waits. */
function growingBuffer(lines: number) {
    const text = Array.from({ length: lines }, (_, i) => `line ${String(i)}`).join("\n") + "\n";
    const bytes = Buffer.from(text);
    const file = new MemoryRandomAccessFile(bytes, { size: bytes.length * 2, gated: true });
    // The first chunk holds the first 20 lines (the open 21st is not counted).
    const buffer = new DiskTextBuffer(file, {
        chunkSize: Buffer.byteLength("line 0\n".repeat(10) + "line 10\n".repeat(10)),
    });
    const indexed = new Promise<void>((resolve) => {
        buffer.onDidChangeIndexing(() => {
            if (buffer.indexing.done) resolve();
        });
    });
    buffer.startIndexing();
    return { buffer, file, indexed };
}

function growing(lines: number) {
    const { buffer, file, indexed } = growingBuffer(lines);
    const doc = new TextDocument(buffer);
    const viewState = new EditorViewState(doc);
    viewState.viewportHeight = 5;
    return { doc, viewState, file, indexed };
}

/** The whole document is in; the cursor sits on its last line, as after Ctrl+End. */
async function openedAtEnd(lines: number) {
    const opened = growing(lines);
    opened.file.openGate();
    await opened.indexed;
    opened.viewState.cursorBottom();
    expect(opened.viewState.selections[0].active.line).toBe(lines);
    return opened;
}

/** An external change: the document is reloaded onto a new buffer on disk, whose first chunk is 20 lines. */
async function reloadAndGrow(doc: TextDocument, lines: number): Promise<void> {
    const next = growingBuffer(lines);
    doc.setText(next.buffer);
    expect(doc.lineCount).toBe(20);
    next.file.openGate();
    await next.indexed;
    expect(doc.lineCount).toBe(lines + 1);
}

describe("EditorViewState over a document that grows (the document on disk)", () => {
    it("the view's row count follows the growth, although the version does not move", async () => {
        const { doc, viewState, file, indexed } = growing(100);
        const before = viewState.getViewLineCount();
        expect(before).toBe(doc.lineCount);
        expect(before).toBeLessThan(100);

        file.openGate();
        await indexed;
        expect(doc.versionId).toBe(0);
        expect(doc.lineCount).toBe(101);
        expect(viewState.getViewLineCount()).toBe(101);
    });

    it("Ctrl+End after the growth lands on the last line and the viewport follows", async () => {
        const { doc, viewState, file, indexed } = growing(100);
        expect(viewState.getViewLineCount()).toBe(doc.lineCount);
        file.openGate();
        await indexed;

        viewState.cursorBottom();
        expect(viewState.selections[0].active.line).toBe(100);
        expect(viewState.scrollTop).toBe(101 - viewState.viewportHeight);
        expect(doc.getLineContent(99)).toBe("line 99");
    });

    describe("a reload (flush) that clamped the cursor", () => {
        it("the cursor follows the growing end to the new last line and stays in view", async () => {
            const { doc, viewState } = await openedAtEnd(100);
            await reloadAndGrow(doc, 60);
            expect(viewState.selections[0].active.line).toBe(60);
            expect(viewState.scrollTop).toBe(61 - viewState.viewportHeight);
        });

        it("a cursor the flush did not clamp stays where it is, even on the provisional last line", async () => {
            const { doc, viewState } = await openedAtEnd(100);
            // Line 19 is the last line of the first chunk: within the reloaded document, not clamped.
            viewState.selections = [createCursorSelection(19, 2)];
            await reloadAndGrow(doc, 60);
            expect(viewState.selections[0]).toMatchObject({ active: { line: 19, character: 2 } });

            const inside = await openedAtEnd(100);
            inside.viewState.selections = [createCursorSelection(5, 1)];
            await reloadAndGrow(inside.doc, 60);
            expect(inside.viewState.selections[0]).toMatchObject({ active: { line: 5, character: 1 } });
        });

        it("a cursor moved off the end after the clamp is left alone; the next flush forgets the clamp", async () => {
            const { doc, viewState } = await openedAtEnd(100);
            const next = growingBuffer(60);
            doc.setText(next.buffer);
            expect(viewState.selections[0].active.line).toBe(19);
            viewState.selections = [createCursorSelection(3, 0)];
            next.file.openGate();
            await next.indexed;
            expect(viewState.selections[0].active.line).toBe(3);

            // The same document reloaded again with the cursor inside: no clamp, no following.
            viewState.selections = [createCursorSelection(10, 0)];
            await reloadAndGrow(doc, 40);
            expect(viewState.selections[0].active.line).toBe(10);
        });

        it("several cursors: the one on the last line follows, the other stays", async () => {
            const { doc, viewState } = await openedAtEnd(100);
            viewState.selections = [createCursorSelection(5, 1), createCursorSelection(100, 0)];
            await reloadAndGrow(doc, 60);
            expect(viewState.selections.map((sel) => sel.active)).toEqual([
                { line: 5, character: 1 },
                { line: 60, character: 0 },
            ]);
        });

        it("a selection to the end of the file keeps reaching the end: only the clamped end follows", async () => {
            const { doc, viewState } = await openedAtEnd(100);
            viewState.selections = [
                { anchor: { line: 10, character: 0 }, active: { line: 100, character: 0 }, idealColumn: undefined },
            ];
            await reloadAndGrow(doc, 60);
            expect(viewState.selections[0]).toMatchObject({
                anchor: { line: 10, character: 0 },
                active: { line: 60, character: 0 },
            });

            const reversed = await openedAtEnd(100);
            reversed.viewState.selections = [
                { anchor: { line: 100, character: 0 }, active: { line: 10, character: 0 }, idealColumn: undefined },
            ];
            await reloadAndGrow(reversed.doc, 60);
            expect(reversed.viewState.selections[0]).toMatchObject({
                anchor: { line: 60, character: 0 },
                active: { line: 10, character: 0 },
            });
        });

        it("a clamped end follows on across the next flush: it goes to the new end, like `tail -F` after a rotation", async () => {
            const { doc, viewState } = await openedAtEnd(100);
            // The first reload clamps the cursor to line 19 and the pass never gets going.
            doc.setText(growingBuffer(60).buffer);
            expect(viewState.selections[0].active).toEqual({ line: 19, character: 0 });
            // The second reload finds the cursor inside its first chunk: nothing to clamp, but the end followed.
            await reloadAndGrow(doc, 40);
            expect(viewState.selections[0].active).toEqual({ line: 40, character: 0 });

            // A cursor the user moved off the end is not carried: the next flush leaves it in place.
            viewState.selections = [createCursorSelection(10, 0)];
            await reloadAndGrow(doc, 50);
            expect(viewState.selections[0].active).toEqual({ line: 10, character: 0 });
        });

        it("in memory, after a reload that clamped: an edit elsewhere is an ordinary remap, no reveal", () => {
            const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${String(i)}`).join("\n");
            const doc = new TextDocument(lines(100));
            const viewState = new EditorViewState(doc);
            viewState.viewportHeight = 5;
            viewState.selections = [createCursorSelection(99, 0)];
            doc.setText(lines(20));
            expect(viewState.selections[0].active).toEqual({ line: 19, character: 0 });

            // A replacement that ends on the last line and grows the document is not the end moving on: the
            // cursor keeps its place.
            doc.applyEdits([{ range: createRange(10, 0, 19, 0), text: lines(25) + "\n" }]);
            expect(doc.lineCount).toBe(36);
            expect(viewState.selections[0].active).toEqual({ line: 19, character: 0 });

            // Nor is an edit on another line.
            doc.applyEdits([{ range: createRange(5, 0, 5, 2), text: "ZZ" }]);
            expect(viewState.selections[0].active).toEqual({ line: 19, character: 0 });

            // A cursor away from the end: lines appended after the last one do not scroll to it.
            viewState.selections = [createCursorSelection(5, 0)];
            viewState.scrollTop = 10;
            doc.applyEdits([{ range: createRange(35, 7, 35, 7), text: "\nmore\nmore" }]);
            expect(viewState.selections[0].active).toEqual({ line: 5, character: 0 });
            expect(viewState.scrollTop).toBe(10);
        });

        it("a selection on the last line follows with its columns; one the clamp collapsed there follows as a cursor", async () => {
            const { doc, viewState } = await openedAtEnd(100);
            viewState.selections = [
                { anchor: { line: 100, character: 0 }, active: { line: 100, character: 3 }, idealColumn: undefined },
            ];
            await reloadAndGrow(doc, 60);
            // The last line is empty (the file ends with a line feed): the columns clamp to it.
            expect(viewState.selections[0]).toMatchObject({
                anchor: { line: 60, character: 0 },
                active: { line: 60, character: 0 },
            });

            // Lines 98..100 are gone with the reload: the clamp leaves a cursor on the provisional last line.
            const spanning = await openedAtEnd(100);
            spanning.viewState.selections = [
                { anchor: { line: 98, character: 0 }, active: { line: 100, character: 0 }, idealColumn: undefined },
            ];
            await reloadAndGrow(spanning.doc, 60);
            expect(spanning.viewState.selections[0]).toMatchObject({
                anchor: { line: 60, character: 0 },
                active: { line: 60, character: 0 },
            });
        });
    });
});
