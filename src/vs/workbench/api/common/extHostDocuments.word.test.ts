import { describe, expect, it } from "vitest";

import { DocumentRegistry, type ExtHostTextDocument } from "./extHostDocuments.ts";
import { Position, Range, Uri } from "./vscodeTypes.ts";

function docWith(text: string): ExtHostTextDocument {
    const registry = new DocumentRegistry();
    return registry.upsertFull({ uri: Uri.file("/a.txt").toString(), text });
}

const TEXT = "const foo = bar(-1.5e3);\n\nlast";

describe("ExtHostTextDocument — getWordRangeAtPosition", () => {
    it("word at a position at the start, middle and right after the end", () => {
        const doc = docWith(TEXT);
        const foo = new Range(0, 6, 0, 9);
        expect(doc.getWordRangeAtPosition(new Position(0, 6))).toEqual(foo);
        expect(doc.getWordRangeAtPosition(new Position(0, 7))).toEqual(foo);
        expect(doc.getWordRangeAtPosition(new Position(0, 9))).toEqual(foo);
    });

    it("between words and on an empty line — undefined", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(0, 11))).toBeUndefined();
        expect(doc.getWordRangeAtPosition(new Position(1, 0))).toBeUndefined();
    });

    it("at the junction of two words — the left one", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(0, 15))).toEqual(new Range(0, 12, 0, 15));
        expect(docWith("x-1.5").getWordRangeAtPosition(new Position(0, 1))).toEqual(new Range(0, 0, 0, 1));
    });

    it("a signed number with an exponent is one word of the default definition", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(0, 18))).toEqual(new Range(0, 16, 0, 22));
    });

    it("a position outside the document is clamped to it", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(99, 99))).toEqual(new Range(2, 0, 2, 4));
        expect(doc.getWordRangeAtPosition(new Position(-1, -1))).toEqual(new Range(0, 0, 0, 5));
    });

    it("an extension regex without the g flag finds its word", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(0, 20), /[\d.e-]+/)).toEqual(new Range(0, 16, 0, 22));
        expect(doc.getWordRangeAtPosition(new Position(0, 7), /\d+/)).toBeUndefined();
    });

    it("a regex matching the empty string throws with the upstream message", () => {
        const doc = docWith(TEXT);
        expect(() => doc.getWordRangeAtPosition(new Position(0, 7), /a*/)).toThrow(
            new Error("[getWordRangeAtPosition]: ignoring custom regexp 'a*' because it matches the empty string."),
        );
    });
});

describe("ExtHostTextDocument — save", () => {
    it("without a host there is nobody to save — an honest false", async () => {
        await expect(docWith(TEXT).save()).resolves.toBe(false);
    });

    it("the core saves via the registry saver: document uri in, the response is the result", async () => {
        const registry = new DocumentRegistry();
        const saved: string[] = [];
        registry.saver = (uri) => {
            saved.push(uri.toString());
            return Promise.resolve(true);
        };
        const doc = registry.getOrCreate(Uri.parse("_claude_fs_right:/repo/a.ts"));

        await expect(doc.save()).resolves.toBe(true);
        expect(saved).toEqual(["_claude_fs_right:/repo/a.ts"]);
    });

    it("a closed document is rejected, as upstream", async () => {
        const doc = docWith(TEXT);
        doc.isClosed = true;
        await expect(doc.save()).rejects.toThrow(new Error("Document has been closed"));
    });
});
