import { afterEach, describe, expect, it, vi } from "vitest";

import { createInsertEdit } from "../core/iTextEdit.ts";
import type { IState } from "../languages/iState.ts";
import type { ITokenizationResult, ITokenizationSupport } from "../languages/iTokenizationSupport.ts";
import { TextDocument } from "../model/textDocument.ts";

import type { ITokensChangedEvent } from "./documentTokenStore.ts";
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
    public constructor(private readonly onLine: () => void = () => undefined) {}
    public getInitialState(): IState {
        return new CounterState(0);
    }
    public tokenizeLine(line: string, state: IState): ITokenizationResult {
        this.onLine();
        const counter = (state as CounterState).value;
        const next = line.startsWith(">") ? new CounterState(counter + 1) : new CounterState(counter);
        return {
            tokens: { tokens: [{ startIndex: 0, scopes: [`s${String(counter)}`] }] },
            endState: next,
        };
    }
}

const lines = (count: number, line = "x"): TextDocument =>
    new TextDocument(new Array<string>(count).fill(line).join("\n"));

async function untilBackgroundCompleted(store: DocumentTokenStore): Promise<void> {
    while (!store.isBackgroundTokenizationCompleted) {
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
}

afterEach(() => {
    vi.useRealTimers();
});

describe("DocumentTokenStore — фоновая токенизация", () => {
    it("докрашивает весь документ без единого запроса рендера и докладывает строки", async () => {
        const doc = lines(300);
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());
        const reported = new Set<number>();
        store.onDidChangeTokens(({ fromLine, toLine }: ITokensChangedEvent) => {
            for (let line = fromLine; line <= toLine; line++) reported.add(line);
        });
        expect(store.getLineTokens(0)).toBeUndefined();

        await untilBackgroundCompleted(store);

        for (let line = 0; line < doc.lineCount; line++) {
            expect(store.getLineTokens(line), `строка ${String(line)}`).toBeDefined();
            expect(store.hasAccurateTokensForLine(line)).toBe(true);
        }
        expect(reported.size).toBe(doc.lineCount);
        store.dispose();
    });

    it("уступает между кусками: за один заход очереди — строки за ~1 мс, не весь файл", () => {
        vi.useFakeTimers();
        // Каждая строка «стоит» 1 мс фейкового времени: кусок обрывается, как
        // только прошло больше миллисекунды, — то есть после второй строки.
        const doc = lines(100);
        const store = new DocumentTokenStore(
            doc,
            new StatefulTokenizer(() => {
                vi.setSystemTime(Date.now() + 1);
            }),
        );

        vi.advanceTimersToNextTimer();
        expect(store.getLineTokens(1)).toBeDefined();
        expect(store.getLineTokens(2)).toBeUndefined();

        vi.runAllTimers();
        expect(store.isBackgroundTokenizationCompleted).toBe(true);
        expect(store.getLineTokens(99)).toBeDefined();
        store.dispose();
    });

    it("правка, сменившая состояние, перекрашивает хвост фоном", async () => {
        const doc = lines(50);
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());
        await untilBackgroundCompleted(store);
        expect(store.getLineTokens(49)?.tokens[0].scopes).toEqual(["s0"]);

        doc.applyEdits([createInsertEdit(0, 0, ">")]);
        expect(store.hasAccurateTokensForLine(49)).toBe(false);
        while (!store.hasAccurateTokensForLine(49)) {
            await new Promise<void>((resolve) => setImmediate(resolve));
        }
        expect(store.getLineTokens(49)?.tokens[0].scopes).toEqual(["s1"]);
        store.dispose();
    });

    it("dispose останавливает фон: токенизатор больше не зовут", () => {
        vi.useFakeTimers();
        const onLine = vi.fn();
        const store = new DocumentTokenStore(lines(100), new StatefulTokenizer(onLine));
        store.dispose();
        vi.runAllTimers();
        expect(onLine).not.toHaveBeenCalled();
    });

    it("смена токенизатора начинает фон заново", async () => {
        const doc = lines(20);
        const store = new DocumentTokenStore(doc, new StatefulTokenizer());
        await untilBackgroundCompleted(store);

        const onLine = vi.fn();
        store.setTokenizationSupport(new StatefulTokenizer(onLine));
        expect(store.isBackgroundTokenizationCompleted).toBe(false);
        expect(store.getLineTokens(0)).toBeUndefined();
        await untilBackgroundCompleted(store);
        expect(onLine).toHaveBeenCalledTimes(doc.lineCount);
        store.dispose();
    });
});
