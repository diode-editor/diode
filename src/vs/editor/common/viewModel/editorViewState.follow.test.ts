import { describe, expect, it } from "vitest";

import { MemoryRandomAccessFile } from "../../../../TestUtils/memoryRandomAccessFile.ts";
import { createRange } from "../core/iRange.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { DiskTextBuffer } from "../model/diskTextBuffer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function log(lines: number, from = 0): string {
    return Array.from({ length: lines }, (_, i) => `line ${String(from + i)}`).join("\n") + "\n";
}

/** A document on disk indexed within its first chunk, under a 5-row view; the file grows through `append`. */
function opened(lines: number) {
    const file = new MemoryRandomAccessFile(Buffer.from(log(lines)));
    const buffer = new DiskTextBuffer(file, { chunkSize: 1 << 16, pageSize: 256 });
    expect(buffer.indexing.done).toBe(true);
    const doc = new TextDocument(buffer);
    const viewState = new EditorViewState(doc);
    viewState.viewportHeight = 5;
    let flips = 0;
    viewState.onDidChangeFollowTail(() => flips++);
    const append = (text: string) => {
        file.append(text);
        expect(buffer.extendTo(file.length)).toBe(true);
    };
    return { doc, viewState, append, flips: () => flips };
}

describe("EditorViewState.followTail — the screen rides the tail of a document on disk", () => {
    it("is off at open and turns on with a cursor moved onto the last line (Ctrl+End), with one event", () => {
        const { viewState, flips } = opened(100);
        expect(viewState.followTail).toBe(false);
        viewState.cursorBottom();
        expect(viewState.followTail).toBe(true);
        expect(flips()).toBe(1);
        viewState.cursorBottom();
        expect(flips()).toBe(1);
    });

    it("with the cursor on the last line, appended lines move it to the new last line and bring it into view", () => {
        const { doc, viewState, append } = opened(100);
        viewState.cursorBottom();
        expect(viewState.selections[0].active.line).toBe(100);

        append(log(3, 100));
        expect(doc.lineCount).toBe(104);
        expect(viewState.selections[0]).toMatchObject({ active: { line: 103, character: 0 } });
        expect(viewState.scrollTop).toBe(104 - viewState.viewportHeight);
        expect(viewState.followTail).toBe(true);
        expect(viewState.getViewLineCount()).toBe(104);
    });

    it("a partial last line grows in place: the cursor keeps its line; the next line feed moves it on", () => {
        const { doc, viewState, append } = opened(10);
        viewState.cursorBottom();
        append("half");
        expect(doc.lineCount).toBe(11);
        expect(doc.getLineContent(10)).toBe("half");
        expect(viewState.selections[0]).toMatchObject({ active: { line: 10, character: 0 } });
        append(" done\n");
        expect(viewState.selections[0]).toMatchObject({ active: { line: 11, character: 0 } });
    });

    it("the column is kept where the new last line has it", () => {
        const { viewState, append } = opened(10);
        viewState.cursorBottom();
        viewState.selections = [createCursorSelection(10, 0)];
        append("abc");
        viewState.cursorEnd();
        expect(viewState.selections[0].active.character).toBe(3);
        append("\nx\n");
        // The new last line is empty: the column clamps to it.
        expect(viewState.selections[0]).toMatchObject({ active: { line: 12, character: 0 } });
    });

    it("a cursor above the end: the screen stands, the line count grows, follow stays off", () => {
        const { doc, viewState, append, flips } = opened(100);
        viewState.selections = [createCursorSelection(5, 2)];
        viewState.scrollTop = 3;
        expect(viewState.followTail).toBe(false);

        append(log(3, 100));
        expect(doc.lineCount).toBe(104);
        expect(viewState.selections[0]).toMatchObject({ active: { line: 5, character: 2 } });
        expect(viewState.scrollTop).toBe(3);
        expect(viewState.followTail).toBe(false);
        expect(flips()).toBe(0);
    });

    it("a cursor moved off the last line turns follow off; back on it — on", () => {
        const { viewState, flips } = opened(100);
        viewState.cursorBottom();
        viewState.cursorUp();
        expect(viewState.followTail).toBe(false);
        viewState.cursorDown();
        expect(viewState.followTail).toBe(true);
        expect(flips()).toBe(3);
    });

    it("a range ending on the last line is not a cursor at the end: no follow, the ordinary remap applies", () => {
        const { viewState, append } = opened(100);
        viewState.selections = [
            { anchor: { line: 90, character: 0 }, active: { line: 100, character: 0 }, idealColumn: undefined },
        ];
        expect(viewState.followTail).toBe(false);
        append(log(2, 100));
        expect(viewState.selections[0]).toMatchObject({
            anchor: { line: 90, character: 0 },
            active: { line: 100, character: 0 },
        });
    });

    it("a range anchored on the last line with its active end above is not a cursor at the end either", () => {
        const { viewState } = opened(100);
        viewState.selections = [
            { anchor: { line: 100, character: 0 }, active: { line: 90, character: 0 }, idealColumn: undefined },
        ];
        expect(viewState.followTail).toBe(false);
    });

    it("several cursors: the ones on the last line follow, the other stays", () => {
        const { viewState, append } = opened(100);
        viewState.selections = [createCursorSelection(5, 1), createCursorSelection(100, 0)];
        expect(viewState.followTail).toBe(true);
        append(log(2, 100));
        expect(viewState.selections.map((sel) => sel.active)).toEqual([
            { line: 5, character: 1 },
            { line: 102, character: 0 },
        ]);
    });

    describe("setFollowTail — the toggle command", () => {
        it("on with the cursor elsewhere: the cursor goes to the end first, then follows", () => {
            const { viewState, append, flips } = opened(100);
            viewState.selections = [createCursorSelection(5, 0)];
            viewState.setFollowTail(true);
            expect(viewState.selections[0]).toMatchObject({ active: { line: 100, character: 0 } });
            expect(viewState.followTail).toBe(true);
            expect(flips()).toBe(1);
            append(log(1, 100));
            expect(viewState.selections[0].active.line).toBe(101);
        });

        it("off with the cursor on the last line: the cursor stays, the next growth leaves it behind", () => {
            const { viewState, append, flips } = opened(100);
            viewState.cursorBottom();
            viewState.setFollowTail(false);
            expect(viewState.followTail).toBe(false);
            expect(viewState.selections[0].active.line).toBe(100);
            expect(flips()).toBe(2);

            const scrollTop = viewState.scrollTop;
            append(log(3, 100));
            expect(viewState.selections[0].active.line).toBe(100);
            expect(viewState.scrollTop).toBe(scrollTop);
            expect(viewState.followTail).toBe(false);

            // Ctrl+End again turns it back on.
            viewState.cursorBottom();
            expect(viewState.followTail).toBe(true);
        });

        it("on with a cursor already on the last line keeps every cursor where it is", () => {
            const { viewState, append } = opened(100);
            viewState.selections = [createCursorSelection(5, 1), createCursorSelection(100, 0)];
            viewState.setFollowTail(false);
            viewState.setFollowTail(true);
            expect(viewState.followTail).toBe(true);
            expect(viewState.selections.map((sel) => sel.active)).toEqual([
                { line: 5, character: 1 },
                { line: 100, character: 0 },
            ]);
            append(log(1, 100));
            expect(viewState.selections.map((sel) => sel.active.line)).toEqual([5, 101]);
        });

        it("on when already following and off when not: no change, no event", () => {
            const { viewState, flips } = opened(100);
            viewState.setFollowTail(false);
            expect(flips()).toBe(0);
            viewState.cursorBottom();
            viewState.setFollowTail(true);
            expect(flips()).toBe(1);
        });
    });

    it("a reload (flush) turns follow on only when it clamped a cursor past the new end", () => {
        const { viewState } = opened(100);
        viewState.cursorBottom();
        const doc = viewState.document;
        // A reload onto a shorter document: the cursor at line 100 is clamped to 59 and follows from there.
        doc.setText(log(60));
        expect(viewState.selections[0].active.line).toBe(60);
        expect(viewState.followTail).toBe(true);

        viewState.selections = [createCursorSelection(5, 0)];
        doc.setText(log(80));
        expect(viewState.followTail).toBe(false);

        // Following, and a reload that does not clamp: off — the cursor is no longer on the end.
        viewState.cursorBottom();
        expect(viewState.followTail).toBe(true);
        doc.setText(log(200));
        expect(viewState.followTail).toBe(false);

        // Not following, and a reload that clamps: on.
        viewState.selections = [createCursorSelection(150, 0)];
        expect(viewState.followTail).toBe(false);
        doc.setText(log(20));
        expect(viewState.followTail).toBe(true);
    });

    it("in memory, an edit by another view after the cursor's last line is an ordinary remap, not follow", () => {
        const doc = new TextDocument(log(20).trimEnd());
        const viewState = new EditorViewState(doc);
        viewState.viewportHeight = 5;
        viewState.cursorBottom();
        expect(viewState.followTail).toBe(true);
        viewState.selections = [createCursorSelection(19, 0)];
        viewState.scrollTop = 0;

        doc.applyEdits([{ range: createRange(19, 7, 19, 7), text: "\nmore\nmore" }]);
        expect(viewState.selections[0]).toMatchObject({ active: { line: 19, character: 0 } });
        expect(viewState.scrollTop).toBe(0);
    });

    it("dispose stops the follow event", () => {
        const { viewState, flips } = opened(10);
        viewState.dispose();
        expect(() => {
            viewState.cursorBottom();
        }).not.toThrow();
        expect(flips()).toBe(0);
    });
});
