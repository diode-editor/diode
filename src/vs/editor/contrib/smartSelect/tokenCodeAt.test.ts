import { describe, expect, it } from "vitest";

import { createPosition } from "../../common/core/iPosition.ts";
import { createRange } from "../../common/core/iRange.ts";
import { createLineTokens, createToken } from "../../common/languages/iLineTokens.ts";
import { NULL_STATE } from "../../common/languages/iState.ts";
import type { ITokenizationSupport } from "../../common/languages/iTokenizationSupport.ts";
import { TextDocument } from "../../common/model/textDocument.ts";
import { DocumentTokenStore } from "../../common/tokens/documentTokenStore.ts";

import { tokenCodeAt } from "./tokenCodeAt.ts";

/** Всё от первой `"` до конца строки — строка-литерал. */
const QUOTE_TO_END: ITokenizationSupport = {
    getInitialState: () => NULL_STATE,
    tokenizeLine: (line) => {
        const quote = line.indexOf('"');
        const tokens = [createToken(0, ["source"])];
        if (quote !== -1) tokens.push(createToken(quote, ["source", "string.quoted"]));
        return { tokens: createLineTokens(tokens), endState: NULL_STATE };
    },
};

const TEXT = 'x"(\ny"(\nz"(';

describe("tokenCodeAt — скобки не-кода по токенам", () => {
    it("строки до нижней каретки размечены: литерал — не код; за ней токенов нет — код", () => {
        const store = new DocumentTokenStore(new TextDocument(TEXT), QUOTE_TO_END);
        const codeAt = tokenCodeAt(store, [createPosition(1, 0), createPosition(0, 0)]);
        expect([codeAt(0, 0), codeAt(0, 2), codeAt(1, 2), codeAt(2, 2)]).toEqual([true, false, false, true]);
    });

    it("устаревшие токены за грязной строкой не в счёт — код", () => {
        const document = new TextDocument(TEXT);
        const store = new DocumentTokenStore(document, QUOTE_TO_END);
        store.forceTokenization(2);
        // Правка строки 1: кэш строки 2 под ней может врать (правка могла открыть
        // или закрыть литерал) — пока его не пересчитали, он не в счёт.
        document.applyEdits([{ range: createRange(1, 0, 1, 0), text: "w" }]);
        const codeAt = tokenCodeAt(store, [createPosition(0, 0)]);
        expect([codeAt(0, 2), codeAt(2, 2)]).toEqual([false, true]);
    });

    it("без грамматики код — всё", () => {
        expect(tokenCodeAt(undefined, [createPosition(0, 0)])(0, 0)).toBe(true);
    });
});
