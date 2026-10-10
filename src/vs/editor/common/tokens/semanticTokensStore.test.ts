import { describe, expect, it, vi } from "vitest";

import { createRange } from "../core/iRange.ts";
import { createInsertEdit, createTextEdit } from "../core/iTextEdit.ts";
import type { ISemanticTokensLegend } from "../languages/iSemanticTokensSource.ts";
import { TextDocument } from "../model/textDocument.ts";

import { decodeSemanticTokens } from "./semanticTokensLines.ts";
import { SemanticTokensStore } from "./semanticTokensStore.ts";

const LEGEND: ISemanticTokensLegend = { tokenTypes: ["a"], tokenModifiers: [] };

/** Токен `[start, start+length)` на строке `line` (одна пятёрка с абсолютной строкой). */
function oneToken(line: number, start: number, length: number) {
    return decodeSemanticTokens(new Uint32Array([line, start, length, 0, 0]), LEGEND);
}

describe("SemanticTokensStore", () => {
    it("пустой: ни полного набора, ни токенов", () => {
        const store = new SemanticTokensStore(new TextDocument("abc"));
        expect(store.hasCompleteSemanticTokens()).toBe(false);
        expect(store.hasSomeSemanticTokens()).toBe(false);
        expect(store.getLineTokens(0)).toBeUndefined();
    });

    it("set кладёт полный набор и фаерит onDidChange; null — очищает, флаг полноты — как передан", () => {
        const store = new SemanticTokensStore(new TextDocument("abc\ndef"));
        const listener = vi.fn();
        store.onDidChange(listener);
        store.set(oneToken(1, 0, 2), true);
        expect(store.getLineTokens(1)?.tokens).toEqual([0, 2, 0, 0]);
        expect(store.hasCompleteSemanticTokens()).toBe(true);
        expect(store.hasSomeSemanticTokens()).toBe(true);
        store.set(null, false);
        expect(store.getLineTokens(1)).toBeUndefined();
        expect(store.hasCompleteSemanticTokens()).toBe(false);
        expect(store.hasSomeSemanticTokens()).toBe(false);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it("setPartial заменяет только свои строки, пока полного набора нет; при полном — игнор без события", () => {
        const store = new SemanticTokensStore(new TextDocument("a\nb\nc"));
        store.setPartial(0, 2, decodeSemanticTokens(new Uint32Array([0, 0, 1, 0, 0, 2, 0, 1, 0, 0]), LEGEND));
        store.setPartial(1, 2, oneToken(1, 0, 1));
        expect(store.getLineTokens(0)?.tokens).toEqual([0, 1, 0, 0]);
        expect(store.getLineTokens(1)?.tokens).toEqual([0, 1, 0, 0]);
        expect(store.getLineTokens(2)).toBeUndefined();
        expect(store.hasCompleteSemanticTokens()).toBe(false);

        store.set(oneToken(0, 0, 1), true);
        const listener = vi.fn();
        store.onDidChange(listener);
        store.setPartial(1, 1, oneToken(1, 0, 1));
        expect(store.getLineTokens(1)).toBeUndefined();
        expect(listener).not.toHaveBeenCalled();
    });

    it("правки документа сдвигают токены (батч — снизу вверх, в исходных координатах)", () => {
        const document = new TextDocument("let foo = 1;\nfoo + bar;");
        const store = new SemanticTokensStore(document);
        store.set(decodeSemanticTokens(new Uint32Array([0, 4, 3, 0, 0, 1, 0, 3, 0, 0, 0, 6, 3, 0, 0]), LEGEND), true);
        document.applyEdits([createInsertEdit(0, 0, "const "), createInsertEdit(1, 6, "xy")]);
        expect(store.getLineTokens(0)?.tokens).toEqual([10, 13, 0, 0]);
        expect(store.getLineTokens(1)?.tokens).toEqual([0, 3, 0, 0, 8, 11, 0, 0]);
        document.applyEdits([createTextEdit(createRange(0, 13, 1, 0), "")]);
        expect(store.getLineTokens(0)?.tokens).toEqual([10, 13, 0, 0, 13, 16, 0, 0, 21, 24, 0, 0]);
    });

    it("замена содержимого целиком (flush) стирает токены", () => {
        const document = new TextDocument("abc");
        const store = new SemanticTokensStore(document);
        store.set(oneToken(0, 0, 2), true);
        document.setText("xyz");
        expect(store.getLineTokens(0)).toBeUndefined();
    });

    it("после dispose правки документа хранилище не трогают", () => {
        const document = new TextDocument("abc");
        const store = new SemanticTokensStore(document);
        store.set(oneToken(0, 1, 2), true);
        store.dispose();
        document.applyEdits([createInsertEdit(0, 0, "zz")]);
        expect(store.getLineTokens(0)?.tokens).toEqual([1, 3, 0, 0]);
    });
});
