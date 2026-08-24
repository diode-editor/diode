import { describe, expect, it } from "vitest";

import { createRange } from "../../common/core/iRange.ts";
import { createCursorSelection, createSelection, withIdealColumn } from "../../common/core/iSelection.ts";
import { TextDocument } from "../../common/model/textDocument.ts";

import {
    captureSession,
    deriveSearchSpec,
    findNextOccurrence,
    isSessionCurrent,
    selectionsShareText,
} from "./multiCursorSession.ts";

const SUBSTRING = { searchText: "foo", wholeWord: false, matchCase: true };

describe("deriveSearchSpec", () => {
    it("схлопнутая каретка на слове даёт слово и поиск по целым словам", () => {
        const doc = new TextDocument("foo bar");
        const spec = deriveSearchSpec(doc, createCursorSelection(0, 1));
        expect(spec).toEqual({
            searchText: "foo",
            wholeWord: true,
            matchCase: true,
            range: createRange(0, 0, 0, 3),
        });
    });

    it("каретка вплотную за словом всё ещё на нём", () => {
        const doc = new TextDocument("foo bar");
        expect(deriveSearchSpec(doc, createCursorSelection(0, 3))?.searchText).toBe("foo");
    });

    it("каретка в пробелах между словами не даёт ничего", () => {
        // Два пробела: позиция 4 не примыкает ни к одному слову.
        const doc = new TextDocument("foo  bar");
        expect(deriveSearchSpec(doc, createCursorSelection(0, 4))).toBeNull();
    });

    it("каретка на пунктуации не даёт ничего", () => {
        const doc = new TextDocument("a + b");
        expect(deriveSearchSpec(doc, createCursorSelection(0, 2))).toBeNull();
    });

    it("непустое однострочное выделение ищется как подстрока", () => {
        const doc = new TextDocument("foobar");
        expect(deriveSearchSpec(doc, createSelection(0, 0, 0, 4))).toEqual({
            searchText: "foob",
            wholeWord: false,
            matchCase: true,
            range: createRange(0, 0, 0, 4),
        });
    });

    it("многострочное выделение не поддержано", () => {
        const doc = new TextDocument("foo\nbar");
        expect(deriveSearchSpec(doc, createSelection(0, 0, 1, 3))).toBeNull();
    });
});

describe("findNextOccurrence", () => {
    const doc = new TextDocument("foo one foo\ntwo foo three");

    it("идёт вперёд от точки отсчёта", () => {
        const next = findNextOccurrence(doc, SUBSTRING, createRange(0, 0, 0, 3), 1, []);
        expect(next).toEqual(createRange(0, 8, 0, 11));
    });

    it("заворачивается через конец документа", () => {
        const next = findNextOccurrence(doc, SUBSTRING, createRange(1, 4, 1, 7), 1, []);
        expect(next).toEqual(createRange(0, 0, 0, 3));
    });

    it("идёт назад", () => {
        const next = findNextOccurrence(doc, SUBSTRING, createRange(1, 4, 1, 7), -1, []);
        expect(next).toEqual(createRange(0, 8, 0, 11));
    });

    it("заворачивается через начало документа", () => {
        const next = findNextOccurrence(doc, SUBSTRING, createRange(0, 0, 0, 3), -1, []);
        expect(next).toEqual(createRange(1, 4, 1, 7));
    });

    it("пропускает уже занятые вхождения", () => {
        const taken = [createRange(0, 0, 0, 3), createRange(0, 8, 0, 11)];
        expect(findNextOccurrence(doc, SUBSTRING, createRange(0, 0, 0, 3), 1, taken)).toEqual(createRange(1, 4, 1, 7));
    });

    it("все вхождения заняты — null", () => {
        const taken = [createRange(0, 0, 0, 3), createRange(0, 8, 0, 11), createRange(1, 4, 1, 7)];
        expect(findNextOccurrence(doc, SUBSTRING, createRange(0, 0, 0, 3), 1, taken)).toBeNull();
    });

    it("вхождений нет вовсе — null", () => {
        const spec = { searchText: "zzz", wholeWord: false, matchCase: true };
        expect(findNextOccurrence(doc, spec, createRange(0, 0, 0, 3), 1, [])).toBeNull();
    });

    it("whole-word: text внутри context не находится", () => {
        const words = new TextDocument("text context text");
        const spec = { searchText: "text", wholeWord: true, matchCase: true };
        expect(findNextOccurrence(words, spec, createRange(0, 0, 0, 4), 1, [])).toEqual(createRange(0, 13, 0, 17));
    });

    it("matchCase: FOO не находится по foo", () => {
        const mixed = new TextDocument("foo FOO");
        // Само `foo` уже занято — если бы `FOO` считалось совпадением, оно бы нашлось.
        const taken = [createRange(0, 0, 0, 3)];
        expect(findNextOccurrence(mixed, SUBSTRING, createRange(0, 0, 0, 3), 1, taken)).toBeNull();
    });
});

describe("isSessionCurrent", () => {
    const doc = new TextDocument("foo bar");
    const selections = [createSelection(0, 0, 0, 3)];
    const session = captureSession(SUBSTRING, createRange(0, 0, 0, 3), selections, doc.versionId);

    it("совпало — сессия жива", () => {
        expect(isSessionCurrent(session, selections, doc.versionId)).toBe(true);
    });

    it("каретка сдвинулась — сессия протухла", () => {
        expect(isSessionCurrent(session, [createSelection(0, 1, 0, 3)], doc.versionId)).toBe(false);
    });

    it("сдвинулось ОДНО выделение из двух — сессия протухла", () => {
        // Совпасть должны все: проверка на одном выделении не различает «все совпали»
        // и «совпал хоть один», а на паре разница видна.
        const pair = [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)];
        const pairSession = captureSession(SUBSTRING, createRange(0, 0, 0, 3), pair, doc.versionId);

        expect(isSessionCurrent(pairSession, [pair[0], createSelection(0, 5, 0, 7)], doc.versionId)).toBe(false);
    });

    it("изменилось число выделений — сессия протухла", () => {
        expect(isSessionCurrent(session, [...selections, createCursorSelection(0, 5)], doc.versionId)).toBe(false);
    });

    it("документ изменился — сессия протухла", () => {
        expect(isSessionCurrent(session, selections, doc.versionId + 1)).toBe(false);
    });

    it("изменился только idealColumn — сессия ЖИВА", () => {
        // idealColumn двигает вертикальная навигация мимо курсора; рвать сессию из-за него
        // значило бы терять её на ровном месте.
        expect(isSessionCurrent(session, [withIdealColumn(selections[0], 42)], doc.versionId)).toBe(true);
    });
});

describe("selectionsShareText", () => {
    const doc = new TextDocument("foo bar\nfoo baz");

    it("одинаковый текст у всех выделений", () => {
        expect(selectionsShareText(doc, [createSelection(0, 0, 0, 3), createSelection(1, 0, 1, 3)], true)).toBe(true);
    });

    it("разный текст", () => {
        expect(selectionsShareText(doc, [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)], true)).toBe(false);
    });

    it("схлопнутая каретка ломает общность", () => {
        expect(selectionsShareText(doc, [createSelection(0, 0, 0, 3), createCursorSelection(1, 0)], true)).toBe(false);
    });

    it("две схлопнутые каретки общего текста не образуют", () => {
        // У обеих текст пустой, то есть формально «одинаковый». Общность ломает
        // сам факт пустоты, а не различие: продолжать поиск здесь нечем.
        expect(selectionsShareText(doc, [createCursorSelection(0, 0), createCursorSelection(1, 0)], true)).toBe(false);
    });

    it("многострочное выделение ломает общность", () => {
        expect(selectionsShareText(doc, [createSelection(0, 0, 1, 3)], true)).toBe(false);
    });

    it("регистр складывается вниз — как в самом поиске", () => {
        // `ß` и `ss` при складывании ВВЕРХ обе дают `SS` и сошлись бы за один текст,
        // а сканер вхождений сравнивает по нижнему регистру и считает их разными.
        // Разойдись эти две операции — Ctrl+D продолжал бы сессию по тексту,
        // которого поиск в документе не находит.
        const sharp = new TextDocument("ß ss");
        const selections = [createSelection(0, 0, 0, 1), createSelection(0, 2, 0, 4)];
        expect(selectionsShareText(sharp, selections, false)).toBe(false);
    });

    it("без учёта регистра FOO и foo считаются одним текстом", () => {
        const mixed = new TextDocument("foo FOO");
        const selections = [createSelection(0, 0, 0, 3), createSelection(0, 4, 0, 7)];
        expect(selectionsShareText(mixed, selections, false)).toBe(true);
        expect(selectionsShareText(mixed, selections, true)).toBe(false);
    });
});
