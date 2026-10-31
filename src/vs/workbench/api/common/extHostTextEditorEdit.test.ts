import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { ExtHostTextDocument } from "./extHostDocuments.ts";
import { applyTextEditorEdit, TextEditorEdit } from "./extHostTextEditorEdit.ts";
import { EndOfLine, Position, Range, Uri } from "./vscodeTypes.ts";

function makeDocument(): vscode.TextDocument {
    const doc = new ExtHostTextDocument(Uri.file("/a.txt"));
    doc.applyFull({ uri: doc.uri.toString(), text: "0123456789", eol: EndOfLine.LF, version: 7 });
    return doc as unknown as vscode.TextDocument;
}

const span = (from: number, to: number): Range => new Range(0, from, 0, to);

function finalizeRanges(...ranges: Range[]): ReturnType<TextEditorEdit["finalize"]> {
    const builder = new TextEditorEdit(makeDocument());
    for (const range of ranges) builder.replace(range, "x");
    return builder.finalize();
}

describe("TextEditorEdit — overlap check", () => {
    it("ranges that don't overlap pass in any order", () => {
        expect(finalizeRanges(span(5, 6), span(0, 2))).not.toBeNull();
        expect(finalizeRanges(span(0, 2), span(5, 6))).not.toBeNull();
    });

    it("overlapping ranges are refused in any order", () => {
        expect(finalizeRanges(span(0, 4), span(2, 6))).toBeNull();
        expect(finalizeRanges(span(2, 6), span(0, 4))).toBeNull();
    });

    it("ranges are ordered by end first: an insertion at the start of a replacement doesn't overlap it", () => {
        expect(finalizeRanges(span(2, 4), span(2, 2))).not.toBeNull();
    });

    it("the same end is ordered by start", () => {
        expect(finalizeRanges(span(4, 4), span(2, 4))).not.toBeNull();
    });

    it("the edits keep the order they were made in", () => {
        expect(finalizeRanges(span(5, 6), span(0, 2))?.edits.map((edit) => edit.range.start.character)).toEqual([5, 0]);
    });
});

describe("TextEditorEdit — builder", () => {
    it("replace at a position is an insertion there", () => {
        const builder = new TextEditorEdit(makeDocument());
        builder.replace(new Position(0, 3), "x");
        expect(builder.finalize()?.edits).toStrictEqual([
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } }, text: "x" },
        ]);
    });

    it.each([EndOfLine.LF, EndOfLine.CRLF])("setEndOfLine takes %s", (eol) => {
        const builder = new TextEditorEdit(makeDocument());
        builder.setEndOfLine(eol);
        expect(builder.finalize()?.setEndOfLine).toBe(eol);
    });

    it("setEndOfLine refuses what is no line ending", () => {
        const builder = new TextEditorEdit(makeDocument());
        expect(() => {
            builder.setEndOfLine(3 as vscode.EndOfLine);
        }).toThrow("Illegal argument: endOfLine");
    });
});

describe("applyTextEditorEdit", () => {
    const run = (
        callback: (builder: vscode.TextEditorEdit) => void,
        options?: { undoStopBefore?: boolean; undoStopAfter?: boolean },
    ) => {
        const send = vi.fn(() => Promise.resolve(true));
        const result = applyTextEditorEdit(makeDocument(), false, callback, options, send);
        return { send, result };
    };
    const insert = (builder: vscode.TextEditorEdit): void => {
        builder.insert(new Position(0, 0), "x");
    };
    const sentOptions = (send: ReturnType<typeof run>["send"]) => {
        expect(send).toHaveBeenCalledOnce();
        const [params] = send.mock.calls[0] as unknown as [Record<string, unknown>];
        const { edits: _edits, ...rest } = params;
        return rest;
    };
    const BASE = { uri: Uri.file("/a.txt").toString(), version: 7 };

    it("nothing written is true without a request", async () => {
        const { send, result } = run(() => undefined);
        await expect(result).resolves.toBe(true);
        expect(send).not.toHaveBeenCalled();
    });

    it("only a line ending is a request with no edits", () => {
        const { send } = run((builder) => {
            builder.setEndOfLine(EndOfLine.CRLF);
        });
        expect(sentOptions(send)).toStrictEqual({ ...BASE, setEndOfLine: EndOfLine.CRLF });
    });

    it("an edit without options sends only what it has", () => {
        expect(sentOptions(run(insert).send)).toStrictEqual(BASE);
    });

    it("undo stops are on by default: only `false` goes over the wire", () => {
        expect(sentOptions(run(insert, { undoStopBefore: true, undoStopAfter: true }).send)).toStrictEqual(BASE);
        expect(sentOptions(run(insert, { undoStopBefore: false }).send)).toStrictEqual({
            ...BASE,
            undoStopBefore: false,
        });
        expect(sentOptions(run(insert, { undoStopAfter: false }).send)).toStrictEqual({
            ...BASE,
            undoStopAfter: false,
        });
    });
});
