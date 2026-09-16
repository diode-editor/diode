import { describe, expect, it } from "vitest";

import { createRange } from "../../common/core/iRange.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import { planToggleBlockComment } from "./blockComments.ts";

/** Применяет план к документу и возвращает [текст, [al, ac, ll, lc] выделения]. */
function toggle(text: string, range: ReturnType<typeof createRange>, open = "/*", close = "*/") {
    const doc = new TextDocument(text);
    const plan = planToggleBlockComment(doc, range, open, close);
    doc.applyEdits([...plan.edits]);
    const sel = plan.selection;
    return [doc.getText(), [sel.anchor.line, sel.anchor.character, sel.active.line, sel.active.character]] as const;
}

describe("planToggleBlockComment — пустое выделение", () => {
    it("вставляет пару с кареткой между пробелами", () => {
        const [text, sel] = toggle("ab", createRange(0, 1, 0, 1));
        expect(text).toBe("a/*  */b");
        expect(sel).toEqual([0, 4, 0, 4]);
    });

    it("каретка внутри пары на строке — пара снимается вместе с пробелами", () => {
        const [text, sel] = toggle("a/* foo */b", createRange(0, 6, 0, 6));
        expect(text).toBe("afoob");
        expect(sel).toEqual([0, 3, 0, 3]);
    });

    it("каретка внутри пустой пары — снятие возвращает исходный текст", () => {
        const [text, sel] = toggle("a/*  */b", createRange(0, 4, 0, 4));
        expect(text).toBe("ab");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("каретка внутри пары без пробелов — токены снимаются как есть", () => {
        const [text, sel] = toggle("x/**/y", createRange(0, 3, 0, 3));
        expect(text).toBe("xy");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("каретка внутри закрывающего токена тоже находит пару", () => {
        const [text] = toggle("/* foo */", createRange(0, 8, 0, 8));
        expect(text).toBe("foo");
    });

    it("закрывающий ищется за концом открывающего, а не внутри него", () => {
        // `/*/ x */`: подстрока `*/` начинается уже на втором символе открывающего
        // токена. Закрывающим считается тот, что ЗА ним, иначе «пара» схлопнулась
        // бы в `/*/` и снимать было бы нечего.
        const [text, sel] = toggle("/*/ x */", createRange(0, 3, 0, 3));
        expect(text).toBe("/ x");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("чужой `*/` левее открывающего не считается закрывающим для каретки", () => {
        // `a */ b /* c */`: перед парой каретки есть посторонний `*/`; снимать
        // надо ту пару, что каретку охватывает, а не первый попавшийся токен.
        const [text, sel] = toggle("a */ b /* c */", createRange(0, 11, 0, 11));
        expect(text).toBe("a */ b c");
        expect(sel).toEqual([0, 8, 0, 8]);
    });

    it("закрывающий токен без открывающего слева — вставляется новая пара", () => {
        // `*/` на строке есть, но каретка левее любого `/*`: снимать нечего.
        const [text, sel] = toggle("a */ b", createRange(0, 0, 0, 0));
        expect(text).toBe("/*  */a */ b");
        expect(sel).toEqual([0, 3, 0, 3]);
    });

    it("каретка после закрытой пары — вставляется новая пара", () => {
        const [text] = toggle("/* a */x", createRange(0, 8, 0, 8));
        expect(text).toBe("/* a */x/*  */");
    });
});

describe("planToggleBlockComment — каретка по всем позициям пары", () => {
    // `x/* foo */y`: пара занимает [1, 10), содержимое `foo` — [4, 7).
    const TEXT = "x/* foo */y";

    for (let caret = 1; caret <= 10; caret++) {
        it(`каретка на ${String(caret)} внутри пары снимает её целиком`, () => {
            const [text, sel] = toggle(TEXT, createRange(0, caret, 0, caret));
            expect(text).toBe("xfooy");
            // Каретка остаётся в пределах бывшего содержимого (вместе с его краями):
            // снятие токенов не может утащить её в чужой текст.
            expect(sel[3]).toBeGreaterThanOrEqual(1);
            expect(sel[3]).toBeLessThanOrEqual(4);
        });
    }

    it("каретка ровно на содержимом отслеживает свой символ", () => {
        // На `o` (индекс 5) → после снятия `/* ` слева символ уезжает на 2.
        const [text, sel] = toggle(TEXT, createRange(0, 5, 0, 5));
        expect(text).toBe("xfooy");
        expect(sel).toEqual([0, 2, 0, 2]);
    });

    it("каретка вне пары (в хвосте строки) вставляет новую пару", () => {
        const [text] = toggle(TEXT, createRange(0, 11, 0, 11));
        expect(text).toBe("x/* foo */y/*  */");
    });

    it("toggle дважды возвращает исходный текст и выделение (round-trip)", () => {
        for (const range of [createRange(0, 2, 0, 5), createRange(0, 0, 0, 5), createRange(0, 1, 0, 4)]) {
            const doc = new TextDocument("const answer = 42;");
            const first = planToggleBlockComment(doc, range, "/*", "*/");
            doc.applyEdits([...first.edits]);

            const wrapped = {
                start: { line: first.selection.anchor.line, character: first.selection.anchor.character },
                end: { line: first.selection.active.line, character: first.selection.active.character },
            };
            const second = planToggleBlockComment(doc, wrapped, "/*", "*/");
            doc.applyEdits([...second.edits]);

            expect(doc.getText()).toBe("const answer = 42;");
            expect(second.selection.anchor.character).toBe(range.start.character);
            expect(second.selection.active.character).toBe(range.end.character);
        }
    });
});

describe("planToggleBlockComment — выделение", () => {
    it("оборачивает выделение и оставляет его на прежнем тексте", () => {
        const [text, sel] = toggle("const a = 1;", createRange(0, 6, 0, 7));
        expect(text).toBe("const /* a */ = 1;");
        expect(sel).toEqual([0, 9, 0, 10]);
    });

    it("выделение вместе с токенами — токены снимаются, выделение сжимается до содержимого", () => {
        const [text, sel] = toggle("const /* a */ = 1;", createRange(0, 6, 0, 13));
        expect(text).toBe("const a = 1;");
        expect(sel).toEqual([0, 6, 0, 7]);
    });

    it("выделение содержимого, обёрнутого токенами снаружи — снимаются наружные", () => {
        const [text, sel] = toggle("const /* a */ = 1;", createRange(0, 9, 0, 10));
        expect(text).toBe("const a = 1;");
        expect(sel).toEqual([0, 6, 0, 7]);
    });

    it("токены без пробелов тоже снимаются", () => {
        const [text, sel] = toggle("/*a*/", createRange(0, 0, 0, 5));
        expect(text).toBe("a");
        expect(sel).toEqual([0, 0, 0, 1]);
    });

    it("выделение ровно `/**/` (пара без содержимого и пробела) снимается целиком", () => {
        const [text, sel] = toggle("x/**/y", createRange(0, 1, 0, 5));
        expect(text).toBe("xy");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("выделение `/*/` — не пара (коротко для обоих токенов), оборачивается", () => {
        // Начинается открывающим и кончается закрывающим, но токены перекрываются:
        // снимать нечего, выделение просто оборачивается.
        const [text] = toggle("/*/", createRange(0, 0, 0, 3));
        expect(text).toBe("/* /*/ */");
    });

    it("выделение ровно пустой пары `/* */` — снимается без двойного съедания пробела", () => {
        const [text, sel] = toggle("x/* */y", createRange(0, 1, 0, 6));
        expect(text).toBe("xy");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("многострочное выделение с ОДИНАКОВЫМИ колонками — не каретка", () => {
        // Схлопнутость определяется и строкой, и колонкой: выделение (0,1)→(1,1)
        // непустое, его надо обернуть, а не вставлять пустую пару.
        const [text, sel] = toggle("aaa\nbbb", createRange(0, 1, 1, 1));
        expect(text).toBe("a/* aa\nb */bb");
        expect(sel).toEqual([0, 4, 1, 1]);
    });

    it("многострочное оборачивание: токены на краях, выделение на прежнем тексте", () => {
        const [text, sel] = toggle("aaa\nbbb", createRange(0, 1, 1, 2));
        expect(text).toBe("a/* aa\nbb */b");
        expect(sel).toEqual([0, 4, 1, 2]);
    });

    it("многострочное снятие: закрывающий кусок в последней строке", () => {
        const [text, sel] = toggle("a/* aa\nbb */b", createRange(0, 1, 1, 5));
        expect(text).toBe("aaa\nbbb");
        expect(sel).toEqual([0, 1, 1, 2]);
    });

    it("каретка на открывающем токене — пара снимается, каретка не сдвигается", () => {
        const [text, sel] = toggle("a/* foo */b", createRange(0, 1, 0, 1));
        expect(text).toBe("afoob");
        expect(sel).toEqual([0, 1, 0, 1]);
    });

    it("наружные токены без пробелов снимаются", () => {
        const [text, sel] = toggle("/*a*/", createRange(0, 2, 0, 3));
        expect(text).toBe("a");
        expect(sel).toEqual([0, 0, 0, 1]);
    });

    it("наружные токены без пробелов снимаются и посреди строки", () => {
        // Важно, что слева/справа есть посторонний текст: токен ищется вплотную
        // к границе выделения (хвост `before`, начало `after`), а не по краям строки.
        const [text, sel] = toggle("x/*a*/y", createRange(0, 3, 0, 4));
        expect(text).toBe("xay");
        expect(sel).toEqual([0, 1, 0, 2]);
    });

    it("закрывающий снаружи без открывающего — выделение оборачивается", () => {
        // Справа `*/` есть, слева `/*` нет: половина пары снятием не считается.
        const [text] = toggle("xa*/y", createRange(0, 1, 0, 2));
        expect(text).toBe("x/* a */*/y");
    });

    it("открывающий снаружи без закрывающего — выделение оборачивается", () => {
        const [text] = toggle("x/*ay", createRange(0, 3, 0, 4));
        expect(text).toBe("x/*/* a */y");
    });

    it("наружные токены на разных строках снимаются, выделение остаётся", () => {
        const [text, sel] = toggle("/* aa\nbb */", createRange(0, 3, 1, 2));
        expect(text).toBe("aa\nbb");
        expect(sel).toEqual([0, 0, 1, 2]);
    });

    it("выделение начинается открывающим, но не кончается закрывающим — оборачивание", () => {
        // Половина пары внутри выделения снятием не считается: обе границы обязаны
        // совпасть, иначе выделение просто оборачивается.
        const [text] = toggle("/* foo bar", createRange(0, 0, 0, 6));
        expect(text).toBe("/* /* foo */ bar");
    });

    it("выделение кончается закрывающим, но не начинается открывающим — оборачивание", () => {
        const [text] = toggle("foo */ bar", createRange(0, 0, 0, 6));
        expect(text).toBe("/* foo */ */ bar");
    });

    it("открывающий токен слева без закрывающего справа — обычное оборачивание", () => {
        const [text] = toggle("/* a", createRange(0, 3, 0, 4));
        expect(text).toBe("/* /* a */");
    });

    it("другие токены пары (<!-- -->)", () => {
        const [text] = toggle("hello", createRange(0, 0, 0, 5), "<!--", "-->");
        expect(text).toBe("<!-- hello -->");
    });
});
