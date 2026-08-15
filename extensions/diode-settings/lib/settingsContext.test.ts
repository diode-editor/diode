import { describe, expect, it } from "vitest";

import { getSettingsCompletionContext, offsetToPosition, positionToOffset } from "./settingsContext.ts";

/**
 * Ставит каретку по маркеру `|` — так кейсы читаются как то, что реально видит
 * пользователь. Возвращает контекст и текст без маркера.
 */
function at(marked: string) {
    const offset = marked.indexOf("|");
    if (offset === -1) throw new Error("В кейсе нет маркера каретки `|`");
    const text = marked.replace("|", "");
    return { context: getSettingsCompletionContext(text, offset), text };
}

/** Кусок текста, который накрыт replaceRange — то, что будет затёрто вставкой. */
function replaced(marked: string): string | null {
    const { context, text } = at(marked);
    if (context === null) return null;
    return text.slice(context.replaceRange.start, context.replaceRange.end);
}

describe("getSettingsCompletionContext — позиция ключа", () => {
    it("распознаёт ключ после открывающей кавычки", () => {
        expect(at('{\n    "edi|\n}').context).toMatchObject({ kind: "key" });
    });

    it("накрывает открывающую кавычку, чтобы вставка её не удвоила", () => {
        expect(replaced('{\n    "edi|\n}')).toBe('"edi');
    });

    it("накрывает обе кавычки, когда ключ уже закрыт", () => {
        expect(replaced('{\n    "edi|"\n}')).toBe('"edi"');
    });

    it("пустой объект → ключ, заменять нечего", () => {
        const { context } = at("{\n    |\n}");
        expect(context).toMatchObject({ kind: "key" });
        expect(replaced("{\n    |\n}")).toBe("");
    });

    it("голое слово без кавычек → ключ, слово заменяется целиком", () => {
        expect(at("{\n    edi|\n}").context).toMatchObject({ kind: "key" });
        expect(replaced("{\n    edi|\n}")).toBe("edi");
    });

    it("второй ключ после запятой", () => {
        expect(at('{\n    "a": 1,\n    "edi|\n}').context).toMatchObject({ kind: "key" });
        expect(replaced('{\n    "a": 1,\n    "edi|\n}')).toBe('"edi');
    });

    it("ключ в середине строки с уже заданным значением", () => {
        expect(replaced('{\n    "a": 1, "b|": 2\n}')).toBe('"b"');
    });

    it("работает при ведущем комментарии (jsonc)", () => {
        expect(at('// comment\n{\n    "edi|\n}').context).toMatchObject({ kind: "key" });
    });

    it("каретка в середине ключа, а не в конце", () => {
        // `"ed|itor"` — токен под кареткой берётся целиком, а не до каретки.
        expect(replaced('{\n    "ed|itor"\n}')).toBe('"editor"');
    });
});

describe("getSettingsCompletionContext — позиция значения", () => {
    it("пустой слот значения → знает ключ", () => {
        expect(at('{\n    "editor.tabSize": |\n}').context).toMatchObject({
            kind: "value",
            key: "editor.tabSize",
        });
    });

    it("начатый bare-литерал заменяется целиком", () => {
        const marked = '{\n    "editor.insertSpaces": t|\n}';
        expect(at(marked).context).toMatchObject({ kind: "value", key: "editor.insertSpaces" });
        expect(replaced(marked)).toBe("t");
    });

    it("строковое значение заменяется вместе с кавычками", () => {
        const marked = '{\n    "terminal.tier": "a|"\n}';
        expect(at(marked).context).toMatchObject({ kind: "value", key: "terminal.tier" });
        expect(replaced(marked)).toBe('"a"');
    });

    it("пустая строка-значение: заменяются обе кавычки", () => {
        expect(replaced('{\n    "terminal.tier": "|"\n}')).toBe('""');
    });

    it("числовое значение заменяется целиком", () => {
        expect(replaced('{\n    "editor.tabSize": 4|\n}')).toBe("4");
    });
});

describe("getSettingsCompletionContext — вне зоны ответственности", () => {
    it("вложенный объект → null (у него нет схемы)", () => {
        expect(at('{\n    "terminal.capabilities": { "osc|" }\n}').context).toBeNull();
    });

    it("пустой документ → null", () => {
        expect(getSettingsCompletionContext("", 0)).toBeNull();
    });

    it("значение у пустого ключа → null (схемы для «» нет)", () => {
        expect(at('{\n    "": |\n}').context).toBeNull();
    });

    it("элемент массива на верхнем уровне → null (ключ там числовой индекс)", () => {
        expect(at("[\n    |\n]").context).toBeNull();
    });
});

describe("positionToOffset / offsetToPosition", () => {
    const text = "{\n    abc\n}";

    it("переводит позицию в офсет", () => {
        expect(positionToOffset(text, 0, 0)).toBe(0);
        expect(positionToOffset(text, 1, 4)).toBe(6);
        expect(positionToOffset(text, 2, 1)).toBe(11);
    });

    it("переводит офсет в позицию", () => {
        expect(offsetToPosition(text, 0)).toEqual({ line: 0, character: 0 });
        expect(offsetToPosition(text, 6)).toEqual({ line: 1, character: 4 });
        expect(offsetToPosition(text, 11)).toEqual({ line: 2, character: 1 });
    });

    it("round-trip на каждом офсете", () => {
        for (let offset = 0; offset <= text.length; offset++) {
            const pos = offsetToPosition(text, offset);
            expect(positionToOffset(text, pos.line, pos.character)).toBe(offset);
        }
    });

    it("клампит позицию за пределами текста", () => {
        expect(positionToOffset(text, 99, 0)).toBe(text.length);
        expect(positionToOffset(text, 1, 999)).toBe(text.length);
        expect(offsetToPosition(text, 999)).toEqual({ line: 2, character: 1 });
    });
});
