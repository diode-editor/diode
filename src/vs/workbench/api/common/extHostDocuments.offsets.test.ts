import { describe, expect, it } from "vitest";

import { DocumentRegistry, type ExtHostTextDocument } from "./extHostDocuments.ts";
import { Position, Range, Uri } from "./vscodeTypes.ts";

// The stock prettier builds its edit through `positionAt`; without it formatting silently
// returned an empty edit list (#381).

function docWith(text: string): ExtHostTextDocument {
    const registry = new DocumentRegistry();
    return registry.upsertFull({ uri: Uri.file("/a.txt").toString(), text });
}

const TEXT = "alpha\nbr\n\nlast";
//            0..5   6..8 9   10..14

describe("ExtHostTextDocument — offsetAt/positionAt", () => {
    it("offsetAt computes the offset from line lengths and separators", () => {
        const doc = docWith(TEXT);
        expect(doc.offsetAt(new Position(0, 0))).toBe(0);
        expect(doc.offsetAt(new Position(0, 5))).toBe(5);
        expect(doc.offsetAt(new Position(1, 0))).toBe(6);
        expect(doc.offsetAt(new Position(2, 0))).toBe(9);
        expect(doc.offsetAt(new Position(3, 4))).toBe(14);
        expect(doc.offsetAt(new Position(3, 4))).toBe(TEXT.length);
    });

    it("positionAt is the inverse of offsetAt at every offset", () => {
        const doc = docWith(TEXT);
        for (let offset = 0; offset <= TEXT.length; offset++) {
            expect(doc.offsetAt(doc.positionAt(offset))).toBe(offset);
        }
    });

    it("positionAt puts a line boundary at the end of the line, not the start of the next", () => {
        const doc = docWith(TEXT);
        expect(doc.positionAt(5)).toEqual(new Position(0, 5));
        expect(doc.positionAt(6)).toEqual(new Position(1, 0));
        expect(doc.positionAt(9)).toEqual(new Position(2, 0));
    });

    it("out-of-bounds offset is clamped to the text", () => {
        const doc = docWith(TEXT);
        expect(doc.positionAt(-10)).toEqual(new Position(0, 0));
        expect(doc.positionAt(1000)).toEqual(new Position(3, 4));
    });

    it("empty document: the only position is (0,0)", () => {
        const doc = docWith("");
        expect(doc.offsetAt(new Position(0, 0))).toBe(0);
        expect(doc.positionAt(0)).toEqual(new Position(0, 0));
        expect(doc.positionAt(7)).toEqual(new Position(0, 0));
    });

    it("CRLF: `\\r` belongs to the line, so offsets match getText()", () => {
        const text = "a\r\nb";
        const doc = docWith(text);
        expect(doc.offsetAt(new Position(1, 1))).toBe(text.length);
        expect(doc.positionAt(text.indexOf("b"))).toEqual(new Position(1, 0));
    });

    it("position past the line end is clamped to its length, not moved to the next line", () => {
        const doc = docWith(TEXT);
        expect(doc.offsetAt(new Position(0, 99))).toBe(5);
        expect(doc.offsetAt(new Position(99, 99))).toBe(TEXT.length);
    });
});

describe("ExtHostTextDocument — validatePosition/validateRange", () => {
    it("valid position is returned as a Position with the same coordinates", () => {
        const doc = docWith(TEXT);
        const valid = doc.validatePosition(new Position(1, 2));
        expect(valid).toEqual(new Position(1, 2));
        expect(valid).toBeInstanceOf(Position);
    });

    it("foreign `{line, character}` becomes our Position", () => {
        const doc = docWith(TEXT);
        const foreign = { line: 1, character: 1 } as Position;
        expect(doc.validatePosition(foreign)).toBeInstanceOf(Position);
        expect(doc.validatePosition(foreign)).not.toBe(foreign);
    });

    it("negative and out-of-range coordinates are clamped", () => {
        const doc = docWith(TEXT);
        expect(doc.validatePosition(new Position(-1, -1))).toEqual(new Position(0, 0));
        expect(doc.validatePosition(new Position(99, 99))).toEqual(new Position(3, 4));
        expect(doc.validatePosition(new Position(1, 99))).toEqual(new Position(1, 2));
    });

    it("validateRange clamps both ends", () => {
        const doc = docWith(TEXT);
        expect(doc.validateRange(new Range(0, 0, 99, 99))).toEqual(new Range(0, 0, 3, 4));
    });

    it("getText(range) beyond document bounds returns text, not an exception", () => {
        const doc = docWith(TEXT);
        expect(doc.getText(new Range(0, 0, 99, 99))).toBe(TEXT);
        expect(doc.getText(new Range(0, 99, 1, 99))).toBe("\nbr");
    });
});
