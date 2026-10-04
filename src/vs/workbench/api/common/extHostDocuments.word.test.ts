import { describe, expect, it } from "vitest";

import { DocumentRegistry, type ExtHostTextDocument } from "./extHostDocuments.ts";
import { Position, Range, Uri } from "./vscodeTypes.ts";

// `getWordRangeAtPosition` и `save` объявлены в активной поверхности
// `vscode.d.ts`, но реализации не было: касты `as unknown as
// vscode.TextDocument` прятали это от компилятора, а `provideHover` типового
// расширения начинается именно с `document.getWordRangeAtPosition(position)`.

function docWith(text: string): ExtHostTextDocument {
    const registry = new DocumentRegistry();
    return registry.upsertFull({ uri: Uri.file("/a.txt").toString(), text });
}

const TEXT = "const foo = bar(-1.5e3);\n\nlast";

describe("ExtHostTextDocument — getWordRangeAtPosition", () => {
    it("слово под позицией в начале, середине и сразу за концом", () => {
        const doc = docWith(TEXT);
        const foo = new Range(0, 6, 0, 9);
        expect(doc.getWordRangeAtPosition(new Position(0, 6))).toEqual(foo);
        expect(doc.getWordRangeAtPosition(new Position(0, 7))).toEqual(foo);
        expect(doc.getWordRangeAtPosition(new Position(0, 9))).toEqual(foo);
    });

    it("между словами и на пустой строке — undefined", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(0, 11))).toBeUndefined();
        expect(doc.getWordRangeAtPosition(new Position(1, 0))).toBeUndefined();
    });

    it("на стыке двух слов — левое", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(0, 15))).toEqual(new Range(0, 12, 0, 15));
        // Слова без зазора: `x` и число `-1.5`.
        expect(docWith("x-1.5").getWordRangeAtPosition(new Position(0, 1))).toEqual(new Range(0, 0, 0, 1));
    });

    it("число со знаком и экспонентой — одно слово дефолтного определения", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(0, 18))).toEqual(new Range(0, 16, 0, 22));
    });

    it("позиция за пределами документа прижимается к нему", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(99, 99))).toEqual(new Range(2, 0, 2, 4));
        expect(doc.getWordRangeAtPosition(new Position(-1, -1))).toEqual(new Range(0, 0, 0, 5));
    });

    it("регекс расширения без флага g ищет своё слово", () => {
        const doc = docWith(TEXT);
        expect(doc.getWordRangeAtPosition(new Position(0, 20), /[\d.e-]+/)).toEqual(new Range(0, 16, 0, 22));
        expect(doc.getWordRangeAtPosition(new Position(0, 7), /\d+/)).toBeUndefined();
    });

    it("регекс, матчащий пустую строку, — исключение с текстом upstream", () => {
        const doc = docWith(TEXT);
        expect(() => doc.getWordRangeAtPosition(new Position(0, 7), /a*/)).toThrow(
            new Error("[getWordRangeAtPosition]: ignoring custom regexp 'a*' because it matches the empty string."),
        );
    });
});

describe("ExtHostTextDocument — save", () => {
    it("RPC сохранения нет — честное false", async () => {
        await expect(docWith(TEXT).save()).resolves.toBe(false);
    });

    it("закрытый документ — отказ, как upstream", async () => {
        const doc = docWith(TEXT);
        doc.isClosed = true;
        await expect(doc.save()).rejects.toThrow(new Error("Document has been closed"));
    });
});
