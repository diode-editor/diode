import type { StackDiff } from "vscode-textmate";
import vsctm from "vscode-textmate";

import { RunOnceScheduler } from "../../../../../../base/common/async.ts";
import type { IDisposable } from "../../../../../../base/common/lifecycle.ts";
import { setTimeout0 } from "../../../../../../base/common/platform.ts";
import { LineRange } from "../../../../../../editor/common/core/ranges/lineRange.ts";
import type { ITokenizationSupport } from "../../../../../../editor/common/languages.ts";
import type { IModelContentChange } from "../../../../../../editor/common/model/iDocumentContentChange.ts";
import { TokenizerWithStateStore } from "../../../../../../editor/common/model/textModelTokens.ts";
import { ContiguousMultilineTokensBuilder } from "../../../../../../editor/common/tokens/contiguousMultilineTokensBuilder.ts";
import { LineTokens } from "../../../../../../editor/common/tokens/lineTokens.ts";
import { TextMateState } from "../../textMateState.ts";
import type { IStateDeltas } from "../textMateWorkerProtocol.ts";

/** Upstream: в один ответ — не больше ~200 строк, отдать управление — через 20 мс. */
const MAX_LINES_PER_BATCH = 200;
const YIELD_AFTER_MS = 20;
/** Upstream: правки копятся 10 мс, потом токенизация продолжается. */
const TOKENIZE_DEBOUNCE_MS = 10;

export interface ITextMateWorkerTokenizerHost {
    getOrCreateSupport(scopeName: string): Promise<ITokenizationSupport | null>;
    setTokensAndStates(versionId: number, tokens: Uint8Array, stateDeltas: IStateDeltas[]): void;
}

/**
 * Модель документа в воркере и её токенизация — upstream `TextMateWorkerTokenizer`
 * (`worker/textMateWorkerTokenizer.ts`). Строки — зеркало документа главного
 * потока (у эталона — `MirrorTextModel`); токенизатор — тот же перенесённый
 * `TokenizerWithStateStore`, что и в главном потоке. Идёт от первой
 * невалидной строки пачками и шлёт токены с разностями состояний; главный
 * поток кладёт их поверх своих правок (`TextMateWorkerTokenizerController`).
 */
export class TextMateWorkerTokenizer implements IDisposable {
    private lines: string[];
    private versionId: number;
    private tokenizerWithStateStore: TokenizerWithStateStore<TextMateState> | null = null;
    private disposed = false;
    private readonly tokenizeDebouncer = new RunOnceScheduler(() => {
        this.tokenize();
    }, TOKENIZE_DEBOUNCE_MS);

    public constructor(
        text: string,
        versionId: number,
        private readonly host: ITextMateWorkerTokenizerHost,
        private readonly scopeName: string,
    ) {
        this.lines = text.split("\n");
        this.versionId = versionId;
        void this.resetTokenization();
    }

    public dispose(): void {
        this.disposed = true;
        this.tokenizeDebouncer.dispose();
    }

    /** Правки батча в порядке применения (как `MirrorTextModel.onEvents`). */
    public onEvents(versionId: number, changes: readonly IModelContentChange[]): void {
        for (const change of changes) {
            const { start, end } = change.range;
            const inserted = change.text.split("\n");
            inserted[0] = this.lines[start.line].slice(0, start.character) + inserted[0];
            inserted[inserted.length - 1] += this.lines[end.line].slice(end.character);
            this.lines = splice(this.lines, start.line, end.line - start.line + 1, inserted);
            this.tokenizerWithStateStore?.store.acceptChange(
                new LineRange(start.line + 1, end.line + 2),
                inserted.length,
            );
        }
        this.versionId = versionId;
        this.tokenizeDebouncer.schedule();
    }

    public retokenize(startLineNumber: number, endLineNumberExclusive: number): void {
        if (this.tokenizerWithStateStore === null) return;
        this.tokenizerWithStateStore.store.invalidateEndStateRange(
            new LineRange(startLineNumber, endLineNumberExclusive),
        );
        this.tokenizeDebouncer.schedule();
    }

    private async resetTokenization(): Promise<void> {
        const support = await this.host.getOrCreateSupport(this.scopeName);
        if (this.disposed || support === null) return;
        this.tokenizerWithStateStore = new TokenizerWithStateStore<TextMateState>(this.lines.length, support);
        this.tokenize();
    }

    private tokenize(): void {
        const tokenizer = this.tokenizerWithStateStore;
        if (this.disposed || tokenizer === null) return;

        const startTime = Date.now();
        for (;;) {
            let tokenizedLines = 0;
            const tokenBuilder = new ContiguousMultilineTokensBuilder();
            const stateDeltaBuilder = new StateDeltaBuilder();

            for (;;) {
                const lineToTokenize = tokenizer.getFirstInvalidLine();
                if (lineToTokenize === null || tokenizedLines > MAX_LINES_PER_BATCH) break;
                tokenizedLines++;

                const text = this.lines[lineToTokenize.lineNumber - 1];
                const r = tokenizer.tokenizationSupport.tokenizeEncoded(text, true, lineToTokenize.startState);
                const endState = r.endState as TextMateState;
                if (tokenizer.store.setEndState(lineToTokenize.lineNumber, endState)) {
                    const delta = vsctm.diffStateStacksRefEq(lineToTokenize.startState.stack, endState.stack);
                    stateDeltaBuilder.setState(lineToTokenize.lineNumber, delta);
                } else {
                    stateDeltaBuilder.setState(lineToTokenize.lineNumber, null);
                }

                LineTokens.convertToEndOffset(r.tokens, text.length);
                tokenBuilder.add(lineToTokenize.lineNumber, r.tokens);

                // yield to check for changes
                if (Date.now() - startTime > YIELD_AFTER_MS) break;
            }

            if (tokenizedLines === 0) break;

            this.host.setTokensAndStates(this.versionId, tokenBuilder.serialize(), stateDeltaBuilder.getStateDeltas());

            if (Date.now() - startTime > YIELD_AFTER_MS) {
                // yield to check for changes
                setTimeout0(() => {
                    this.tokenize();
                });
                return;
            }
        }
    }
}

/** Upstream `StateDeltaBuilder`: разности подряд идущих строк — одним блоком. */
class StateDeltaBuilder {
    private lastStartLineNumber = -1;
    private readonly stateDeltas: { startLineNumber: number; stateDeltas: (StackDiff | null)[] }[] = [];

    public setState(lineNumber: number, stackDiff: StackDiff | null): void {
        if (lineNumber === this.lastStartLineNumber + 1) {
            this.stateDeltas[this.stateDeltas.length - 1].stateDeltas.push(stackDiff);
        } else {
            this.stateDeltas.push({ startLineNumber: lineNumber, stateDeltas: [stackDiff] });
        }
        this.lastStartLineNumber = lineNumber;
    }

    public getStateDeltas(): IStateDeltas[] {
        return this.stateDeltas;
    }
}

/**
 * `Array.prototype.splice` без spread'а: вставка сотен тысяч строк (вставка
 * большого буфера) спредом в аргументы переполнила бы стек.
 */
function splice(lines: string[], start: number, deleteCount: number, inserted: string[]): string[] {
    if (inserted.length <= 1000) {
        lines.splice(start, deleteCount, ...inserted);
        return lines;
    }
    return lines.slice(0, start).concat(inserted, lines.slice(start + deleteCount));
}
