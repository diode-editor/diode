import { describe, expect, it } from "vitest";

import { DocumentRegistry, type ExtHostTextDocument } from "./extHostDocuments.ts";
import { Position, Range, Uri } from "./vscodeTypes.ts";

// `offsetAt`/`positionAt`/`validateRange`/`validatePosition` объявлены в
// активной поверхности `vscode.d.ts`, но в субпроцессе их не было вовсе — и
// обращение к ним падало TypeError внутри провайдера, который языковой шов
// глотает. Именно на этом молча ломался стоковый prettier: его `minimalEdit`
// строит правку через `positionAt`, а формат документа возвращал пустой список
// правок (#381).

function docWith(text: string): ExtHostTextDocument {
    const registry = new DocumentRegistry();
    return registry.upsertFull({ uri: Uri.file("/a.txt").toString(), text });
}

const TEXT = "alpha\nbr\n\nlast";
//            0..5   6..8 9   10..14

describe("ExtHostTextDocument — offsetAt/positionAt", () => {
    it("offsetAt считает смещение через длины строк и разделители", () => {
        const doc = docWith(TEXT);
        expect(doc.offsetAt(new Position(0, 0))).toBe(0);
        expect(doc.offsetAt(new Position(0, 5))).toBe(5);
        expect(doc.offsetAt(new Position(1, 0))).toBe(6);
        expect(doc.offsetAt(new Position(2, 0))).toBe(9);
        expect(doc.offsetAt(new Position(3, 4))).toBe(14);
        expect(doc.offsetAt(new Position(3, 4))).toBe(TEXT.length);
    });

    it("positionAt — обратная функция к offsetAt на каждом смещении", () => {
        const doc = docWith(TEXT);
        for (let offset = 0; offset <= TEXT.length; offset++) {
            expect(doc.offsetAt(doc.positionAt(offset))).toBe(offset);
        }
    });

    it("positionAt кладёт границу строки на конец строки, а не на начало следующей", () => {
        const doc = docWith(TEXT);
        expect(doc.positionAt(5)).toEqual(new Position(0, 5));
        expect(doc.positionAt(6)).toEqual(new Position(1, 0));
        expect(doc.positionAt(9)).toEqual(new Position(2, 0));
    });

    it("смещение за границами прижимается к тексту", () => {
        const doc = docWith(TEXT);
        expect(doc.positionAt(-10)).toEqual(new Position(0, 0));
        expect(doc.positionAt(1000)).toEqual(new Position(3, 4));
    });

    it("пустой документ: единственная позиция — (0,0)", () => {
        const doc = docWith("");
        expect(doc.offsetAt(new Position(0, 0))).toBe(0);
        expect(doc.positionAt(0)).toEqual(new Position(0, 0));
        expect(doc.positionAt(7)).toEqual(new Position(0, 0));
    });

    it("CRLF: `\\r` входит в строку, поэтому смещения совпадают с getText()", () => {
        const text = "a\r\nb";
        const doc = docWith(text);
        expect(doc.offsetAt(new Position(1, 1))).toBe(text.length);
        expect(doc.positionAt(text.indexOf("b"))).toEqual(new Position(1, 0));
    });

    it("позиция за концом строки прижимается к её длине, а не уезжает на следующую", () => {
        const doc = docWith(TEXT);
        expect(doc.offsetAt(new Position(0, 99))).toBe(5);
        expect(doc.offsetAt(new Position(99, 99))).toBe(TEXT.length);
    });
});

describe("ExtHostTextDocument — validatePosition/validateRange", () => {
    it("валидная позиция возвращается как Position с теми же координатами", () => {
        const doc = docWith(TEXT);
        const valid = doc.validatePosition(new Position(1, 2));
        expect(valid).toEqual(new Position(1, 2));
        expect(valid).toBeInstanceOf(Position);
    });

    it("чужой `{line, character}` превращается в наш Position", () => {
        const doc = docWith(TEXT);
        const foreign = { line: 1, character: 1 } as Position;
        expect(doc.validatePosition(foreign)).toBeInstanceOf(Position);
        expect(doc.validatePosition(foreign)).not.toBe(foreign);
    });

    it("отрицательные и запредельные координаты прижимаются", () => {
        const doc = docWith(TEXT);
        expect(doc.validatePosition(new Position(-1, -1))).toEqual(new Position(0, 0));
        expect(doc.validatePosition(new Position(99, 99))).toEqual(new Position(3, 4));
        expect(doc.validatePosition(new Position(1, 99))).toEqual(new Position(1, 2));
    });

    it("validateRange прижимает оба конца", () => {
        const doc = docWith(TEXT);
        expect(doc.validateRange(new Range(0, 0, 99, 99))).toEqual(new Range(0, 0, 3, 4));
    });

    it("getText(range) за границами документа отдаёт текст, а не исключение", () => {
        const doc = docWith(TEXT);
        expect(doc.getText(new Range(0, 0, 99, 99))).toBe(TEXT);
        expect(doc.getText(new Range(0, 99, 1, 99))).toBe("\nbr");
    });
});
