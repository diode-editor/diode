import { describe, expect, it } from "vitest";

import type { ICoreSignature } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

import { activeParameterSpan, wrapSignature } from "./signatureLayout.ts";

function signature(label: string, parameters: ICoreSignature["parameters"]): ICoreSignature {
    return { label, parameters };
}

describe("activeParameterSpan — where the highlight lands", () => {
    it("a string label is searched at a word boundary, not with the first indexOf", () => {
        const sig = signature("greet(nameLength: number, name: string): void", [
            { label: "nameLength: number" },
            { label: "name" },
        ]);

        expect(activeParameterSpan(sig, 1)).toEqual([26, 30]);
        expect(sig.label.slice(26, 30)).toBe("name");
    });

    it("an offset-pair label is taken as is", () => {
        const sig = signature("greet(name: string)", [{ label: [6, 18] as const }]);

        expect(activeParameterSpan(sig, 0)).toEqual([6, 18]);
    });

    it("empty range: no parameter, empty label, inverted pair, not found", () => {
        const sig = signature("greet(name: string)", [
            { label: "" },
            { label: [10, 10] as const },
            { label: "missing" },
        ]);

        expect(activeParameterSpan(sig, 3)).toEqual([0, 0]);
        expect(activeParameterSpan(sig, 0)).toEqual([0, 0]);
        expect(activeParameterSpan(sig, 1)).toEqual([0, 0]);
        expect(activeParameterSpan(sig, 2)).toEqual([0, 0]);
    });

    it("a negative index highlights nothing", () => {
        const sig = signature("greet(name: string)", [{ label: "name" }]);

        expect(activeParameterSpan(sig, -1)).toEqual([0, 0]);
    });

    it("a parameter at the very start of the label has a left boundary", () => {
        const sig = signature("name: string", [{ label: "name" }]);

        expect(activeParameterSpan(sig, 0)).toEqual([0, 4]);
    });

    it("a parameter at the very end of the label has a right boundary too", () => {
        // The server may send a truncated label (`greet(name` without the paren):
        // the last character simply has no neighbor.
        const sig = signature("greet(name", [{ label: "name" }]);

        expect(activeParameterSpan(sig, 0)).toEqual([6, 10]);
    });

    it("an occurrence only inside a word means not found", () => {
        const sig = signature("greet(username: string)", [{ label: "name" }]);

        expect(activeParameterSpan(sig, 0)).toEqual([0, 0]);
    });
});

describe("wrapSignature — wrapping that preserves offsets", () => {
    it("a short label is one chunk at offset zero", () => {
        expect(wrapSignature("greet(name: string)", 40)).toEqual([{ text: "greet(name: string)", start: 0 }]);
    });

    it("a long label is split at words, offsets point into the original string", () => {
        const label = "greet(name: string, age: number): void";

        const chunks = wrapSignature(label, 22);

        expect(chunks).toEqual([
            { text: "greet(name: string,", start: 0 },
            { text: "age: number): void", start: 20 },
        ]);
        for (const chunk of chunks) {
            expect(label.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
        }
    });

    it("a word wider than the line is split by width", () => {
        const chunks = wrapSignature("aVeryLongIdentifierWithoutSpaces", 10);

        expect(chunks).toEqual([
            { text: "aVeryLongI", start: 0 },
            { text: "dentifierW", start: 10 },
            { text: "ithoutSpac", start: 20 },
            { text: "es", start: 30 },
        ]);
    });

    it("wide characters count by display width, not by string length", () => {
        // Each CJK character is two columns: exactly two fit into width 4.
        expect(wrapSignature("abc(名前名前)", 4)).toEqual([
            { text: "abc(", start: 0 },
            { text: "名前", start: 4 },
            { text: "名前", start: 6 },
            { text: ")", start: 8 },
        ]);
    });

    it("a wide character wider than the whole line still advances the scan", () => {
        expect(wrapSignature("名前", 1)).toEqual([
            { text: "名", start: 0 },
            { text: "前", start: 1 },
        ]);
    });

    it("a newline in the label is a hard break, \\n does not end up in a chunk", () => {
        const label = "greet(\n    name: string,\n)";

        const chunks = wrapSignature(label, 40);

        expect(chunks).toEqual([
            { text: "greet(", start: 0 },
            { text: "name: string,", start: 11 },
            { text: ")", start: 25 },
        ]);
        for (const chunk of chunks) {
            expect(label.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
        }
    });

    it("zero and negative width yield no chunks", () => {
        expect(wrapSignature("greet()", 0)).toEqual([]);
        expect(wrapSignature("greet()", -1)).toEqual([]);
    });

    it("an empty label yields no empty line in the popup", () => {
        expect(wrapSignature("", 20)).toEqual([]);
        expect(wrapSignature("   ", 20)).toEqual([]);
    });
});
