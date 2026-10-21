import { describe, expect, it } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createTextEdit } from "../core/iTextEdit.ts";

import { TextDocument } from "./textDocument.ts";

describe("TextDocument.applyEdits — same-start tie-breaking", () => {
    it("orders two edits sharing a start by their end position when collecting old texts", () => {
        const doc = new TextDocument("abcdef");
        const insert = createTextEdit(createRange(0, 2, 0, 2), "X");
        const replace = createTextEdit(createRange(0, 2, 0, 4), "YY");

        const { inverseEdits } = doc.applyEdits([replace, insert]);

        expect(doc.getText()).toBe("abXYYef");

        const restored = new TextDocument("abXYYef");
        restored.applyEdits(inverseEdits);
        expect(restored.getText()).toBe("abcdef");
    });

    it("reverse-application sort tie-breaks on end position so both edits land safely", () => {
        const doc = new TextDocument("hello");
        const insert = createTextEdit(createRange(0, 0, 0, 0), ">");
        const replace = createTextEdit(createRange(0, 0, 0, 1), "H");

        doc.applyEdits([insert, replace]);

        expect(doc.getText()).toBe(">Hello");
    });

    it("produces inverse edits that round-trip when starts collide", () => {
        const doc = new TextDocument("0123456789");
        const a = createTextEdit(createRange(0, 5, 0, 5), "AA");
        const b = createTextEdit(createRange(0, 5, 0, 7), "B");

        const { inverseEdits } = doc.applyEdits([a, b]);
        const after = doc.getText();
        expect(after).not.toBe("0123456789");

        const replay = new TextDocument(after);
        replay.applyEdits(inverseEdits);
        expect(replay.getText()).toBe("0123456789");
    });
});
