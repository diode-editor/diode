import { describe, expect, it } from "vitest";

import { createInsertEdit } from "../core/iTextEdit.ts";
import type { IState } from "../languages/iState.ts";
import type { ITokenizationResult, ITokenizationSupport } from "../languages/iTokenizationSupport.ts";
import { TextDocument } from "../model/textDocument.ts";

import { DocumentTokenStore } from "./documentTokenStore.ts";

class CounterState implements IState {
    public readonly value: number;
    public constructor(value: number) {
        this.value = value;
    }
    public clone(): IState {
        return new CounterState(this.value);
    }
    public equals(other: IState): boolean {
        return other instanceof CounterState && other.value === this.value;
    }
}

/** Lines starting with `>` bump the counter; the token scope records the incoming state. */
class StatefulTokenizer implements ITokenizationSupport {
    public getInitialState(): IState {
        return new CounterState(0);
    }
    public tokenizeLine(line: string, state: IState): ITokenizationResult {
        const counter = (state as CounterState).value;
        const next = line.startsWith(">") ? new CounterState(counter + 1) : new CounterState(counter);
        return {
            tokens: { tokens: [{ startIndex: 0, scopes: [`s${String(counter)}`] }] },
            endState: next,
        };
    }
}

const tenLines = (): TextDocument => new TextDocument("a\nb\nc\nd\ne\nf\ng\nh\ni\nj");

/**
 * Реальный вызывающий (`EditorElement.render`) токенизирует только до низа
 * вьюпорта, поэтому хвост документа регулярно остаётся нетронутым. Ранний
 * выход по сошедшемуся end-state не имеет права объявлять валидным то, что
 * ещё ни разу не токенизировали.
 */
describe("DocumentTokenStore — виден только вьюпорт", () => {
    it("после правки выше вьюпорта хвост всё ещё токенизируется", () => {
        const doc = tenLines();
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());

        // Вьюпорт — строки 0..3, ниже ничего не считали.
        store.tokenizeUpTo(3);
        expect(store.getLineTokens(4)).toBeUndefined();

        // Правка в строке 0, не меняющая end-state → сходимость на строке 1.
        doc.applyEdits([createInsertEdit(0, 0, "X")]);
        store.tokenizeUpTo(3);

        // Скролл вниз: строки 4..9 обязаны получить токены.
        store.tokenizeUpTo(doc.lineCount - 1);
        for (let line = 0; line < doc.lineCount; line++) {
            expect(store.getLineTokens(line), `строка ${String(line)}`).toBeDefined();
        }
    });

    it("правка в нетокенизированном хвосте не оставляет дыру выше курсора", () => {
        // Строка 1 переводит состояние в 1 — всё ниже неё обязано нести `s1`.
        const doc = new TextDocument("a\n>b\nc\nd\ne\nf\ng\nh\ni\nj");
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());

        // Вьюпорт сверху; правка строки 0 сходится по end-state уже на строке 1.
        store.tokenizeUpTo(3);
        doc.applyEdits([createInsertEdit(0, 0, "X")]);
        store.tokenizeUpTo(3);

        // Пользователь уехал вниз и правит строку 7 — рендер тянет до низа вьюпорта.
        doc.applyEdits([createInsertEdit(7, 0, "Y")]);
        store.tokenizeUpTo(9);

        for (let line = 0; line < doc.lineCount; line++) {
            expect(store.getLineTokens(line), `строка ${String(line)}`).toBeDefined();
        }
        // Строки ниже `>` обязаны нести состояние 1, а не начальное 0 — иначе
        // хвост подсвечивается «с чистого листа».
        expect(store.getLineTokens(9)?.tokens[0].scopes).toEqual(["s1"]);
    });
});
