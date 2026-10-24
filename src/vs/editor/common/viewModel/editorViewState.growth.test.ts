import { describe, expect, it } from "vitest";

import { MemoryRandomAccessFile } from "../../../../TestUtils/memoryRandomAccessFile.ts";
import { DiskTextBuffer } from "../model/diskTextBuffer.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

/** A document on disk whose index grows under the view: the file reports more bytes than it has, the pass waits. */
function growing(lines: number) {
    const text = Array.from({ length: lines }, (_, i) => `line ${String(i)}`).join("\n") + "\n";
    const bytes = Buffer.from(text);
    const file = new MemoryRandomAccessFile(bytes, { size: bytes.length * 2, gated: true });
    // The first chunk holds the first 20 lines (the open 21st is not counted).
    const buffer = new DiskTextBuffer(file, {
        chunkSize: Buffer.byteLength("line 0\n".repeat(10) + "line 10\n".repeat(10)),
    });
    const doc = new TextDocument(buffer);
    const viewState = new EditorViewState(doc);
    viewState.viewportHeight = 5;
    const indexed = new Promise<void>((resolve) => {
        buffer.onDidChangeIndexing(() => {
            if (buffer.indexing.done) resolve();
        });
    });
    buffer.startIndexing();
    return { doc, viewState, file, indexed };
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
});
