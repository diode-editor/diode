import { describe, expect, it } from "vitest";

import type { ICoreSignature } from "../../../../editor/common/languages/iSignatureHelpSource.ts";

import { activeParameterSpan, wrapSignature } from "./signatureLayout.ts";

function signature(label: string, parameters: ICoreSignature["parameters"]): ICoreSignature {
    return { label, parameters };
}

describe("activeParameterSpan — куда ложится подсветка", () => {
    it("строковая метка ищется по границе слова, а не первым indexOf", () => {
        // `name` встречается внутри `nameLength` РАНЬШЕ, чем сам параметр:
        // голый indexOf подсветил бы кусок чужого параметра.
        const sig = signature("greet(nameLength: number, name: string): void", [
            { label: "nameLength: number" },
            { label: "name" },
        ]);

        expect(activeParameterSpan(sig, 1)).toEqual([26, 30]);
        expect(sig.label.slice(26, 30)).toBe("name");
    });

    it("метка-пара офсетов берётся как есть", () => {
        const sig = signature("greet(name: string)", [{ label: [6, 18] as const }]);

        expect(activeParameterSpan(sig, 0)).toEqual([6, 18]);
    });

    it("пустой диапазон: нет параметра, пустая метка, вывернутая пара, не найдено", () => {
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

    it("отрицательный индекс не подсвечивает ничего", () => {
        const sig = signature("greet(name: string)", [{ label: "name" }]);

        expect(activeParameterSpan(sig, -1)).toEqual([0, 0]);
    });

    it("параметр в самом начале метки — граница слева есть", () => {
        const sig = signature("name: string", [{ label: "name" }]);

        expect(activeParameterSpan(sig, 0)).toEqual([0, 4]);
    });

    it("параметр в самом конце метки — справа граница тоже есть", () => {
        // Метку сервер вправе прислать оборванной (`greet(name` без скобки):
        // за последним символом просто нет соседа.
        const sig = signature("greet(name", [{ label: "name" }]);

        expect(activeParameterSpan(sig, 0)).toEqual([6, 10]);
    });

    it("вхождение только внутри слова = не найдено", () => {
        const sig = signature("greet(username: string)", [{ label: "name" }]);

        expect(activeParameterSpan(sig, 0)).toEqual([0, 0]);
    });
});

describe("wrapSignature — перенос с сохранением офсетов", () => {
    it("короткая метка — один кусок с нулевым офсетом", () => {
        expect(wrapSignature("greet(name: string)", 40)).toEqual([{ text: "greet(name: string)", start: 0 }]);
    });

    it("длинная метка режется по словам, офсеты указывают в исходную строку", () => {
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

    it("слово шире строки режется по ширине", () => {
        const chunks = wrapSignature("aVeryLongIdentifierWithoutSpaces", 10);

        expect(chunks).toEqual([
            { text: "aVeryLongI", start: 0 },
            { text: "dentifierW", start: 10 },
            { text: "ithoutSpac", start: 20 },
            { text: "es", start: 30 },
        ]);
    });

    it("широкие символы считаются по экранной ширине, а не по длине строки", () => {
        // Каждый иероглиф — две колонки: в ширину 4 влезает ровно два.
        expect(wrapSignature("абв(名前名前)", 4)).toEqual([
            { text: "абв(", start: 0 },
            { text: "名前", start: 4 },
            { text: "名前", start: 6 },
            { text: ")", start: 8 },
        ]);
    });

    it("широкий символ шире всей строки всё равно сдвигает разбор", () => {
        expect(wrapSignature("名前", 1)).toEqual([
            { text: "名", start: 0 },
            { text: "前", start: 1 },
        ]);
    });

    it("перевод строки в метке — жёсткий перенос, «\\n» не попадает в кусок", () => {
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

    it("нулевая и отрицательная ширина не дают кусков", () => {
        expect(wrapSignature("greet()", 0)).toEqual([]);
        expect(wrapSignature("greet()", -1)).toEqual([]);
    });

    it("пустая метка не даёт пустой строки в попапе", () => {
        expect(wrapSignature("", 20)).toEqual([]);
        expect(wrapSignature("   ", 20)).toEqual([]);
    });
});
