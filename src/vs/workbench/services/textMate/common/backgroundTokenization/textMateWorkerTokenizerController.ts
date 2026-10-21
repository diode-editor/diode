import type { StackDiff, StateStack } from "vscode-textmate";
import vsctm from "vscode-textmate";

import { Disposable } from "../../../../../base/common/lifecycle.ts";
import { countEOL } from "../../../../../editor/common/core/misc/eolCounter.ts";
import { LineRange } from "../../../../../editor/common/core/ranges/lineRange.ts";
import type { IBackgroundTokenizationStore } from "../../../../../editor/common/languages.ts";
import type {
    IModelContentChange,
    IModelContentChangedEvent,
} from "../../../../../editor/common/model/iDocumentContentChange.ts";
import type { ITextDocument } from "../../../../../editor/common/model/iTextDocument.ts";
import { TokenizationStateStore } from "../../../../../editor/common/model/textModelTokens.ts";
import { ContiguousMultilineTokensBuilder } from "../../../../../editor/common/tokens/contiguousMultilineTokensBuilder.ts";
import { TextMateState } from "../textMateState.ts";

import type { IStateDeltas, MainToWorkerMessage } from "./textMateWorkerProtocol.ts";

/**
 * Документ главного потока, токенизируемый в воркере, — upstream
 * `TextMateWorkerTokenizerController`. Шлёт воркеру модель и её правки, а
 * его ответы (токены и разности состояний в координатах той версии, которую
 * воркер видел) кладёт в стор документа поверх правок, о которых воркер ещё
 * не знает:
 *
 * ```
 * states, change{k}, …, change{versionId}, ответ воркера, change{j}, …, change{m}, документ
 *         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ прошлые                  ^^^^^^^^^^^^^^^^^^^^^^ будущие
 * ```
 *
 * Строки, которые будущие правки задели, отбрасываются — их воркер пришлёт
 * заново, получив правки (эталон так же фильтрует, «to prevent flickering»).
 * Остальные сдвигаются на разницу строк будущих правок.
 */
export class TextMateWorkerTokenizerController extends Disposable {
    private readonly pendingChanges: IModelContentChangedEvent[] = [];
    /**
     * Состояния концов строк, как их видит воркер (в координатах его версии):
     * разности приходят к ним. `states.getEndState(i)` — конец строки `i`
     * (с 1).
     */
    private states = new TokenizationStateStore<StateStack>();
    /** Версия последней модели, отправленной целиком: ответы старше — о прежнем тексте. */
    private modelVersionId: number;

    public constructor(
        public readonly controllerId: number,
        private readonly document: ITextDocument,
        private readonly scopeName: string,
        private readonly send: (message: MainToWorkerMessage) => void,
        private readonly tokenStore: IBackgroundTokenizationStore,
    ) {
        super();
        this.modelVersionId = document.versionId;
        this.sendModel();

        this.register(
            document.onDidChangeModelContent((e) => {
                // Модель отправлена уже с этой правкой (контроллер создан из её
                // же обработчика — пересоздание токенизатора).
                if (e.versionId <= this.modelVersionId) return;
                if (e.isFlush) {
                    // Upstream на flush пересоздаёт фон целиком; у нас — та же
                    // модель воркера заново, ответы о прежнем тексте отсекает версия.
                    this.modelVersionId = e.versionId;
                    this.pendingChanges.length = 0;
                    this.states = new TokenizationStateStore<StateStack>();
                    this.sendModel();
                    return;
                }
                this.send({
                    type: "acceptModelChanged",
                    controllerId: this.controllerId,
                    versionId: e.versionId,
                    changes: e.changes,
                });
                this.pendingChanges.push(e);
            }),
        );
    }

    public override dispose(): void {
        super.dispose();
        this.send({ type: "acceptRemovedModel", controllerId: this.controllerId });
    }

    public requestTokens(startLineNumber: number, endLineNumberExclusive: number): void {
        this.send({ type: "retokenize", controllerId: this.controllerId, startLineNumber, endLineNumberExclusive });
    }

    /** Ответ воркера (upstream — через `TextMateWorkerHost.$setTokensAndStates`). */
    public setTokensAndStates(versionId: number, rawTokens: Uint8Array, stateDeltas: readonly IStateDeltas[]): void {
        if (versionId < this.modelVersionId) return;

        // Apply past changes to states
        let change = this.pendingChanges.at(0);
        while (change !== undefined && change.versionId <= versionId) {
            this.pendingChanges.shift();
            acceptChanges(this.states, change.changes);
            change = this.pendingChanges.at(0);
        }

        const toCurrent = (lineIndex: number): number | undefined => transformLine(this.pendingChanges, lineIndex);

        // Filter tokens in lines that got changed in the future to prevent flickering.
        // These tokens are recomputed anyway.
        const builder = new ContiguousMultilineTokensBuilder();
        for (const block of ContiguousMultilineTokensBuilder.deserialize(rawTokens)) {
            for (let i = block.startLineNumber; i <= block.endLineNumber; i++) {
                const current = toCurrent(i - 1);
                if (current !== undefined) builder.add(current + 1, block.getLineTokens(i) as Uint32Array);
            }
        }

        // Apply state deltas to states and to the document's store
        const lineCount = this.document.lineCount;
        for (const d of stateDeltas) {
            let prevState: StateStack | null =
                d.startLineNumber <= 1 ? vsctm.INITIAL : this.states.getEndState(d.startLineNumber - 1);
            for (let i = 0; i < d.stateDeltas.length; i++) {
                const lineNumber = d.startLineNumber + i;
                const delta = d.stateDeltas[i] as StackDiff | null;
                let state: StateStack | null;
                if (delta !== null) {
                    state = vsctm.applyStateStackDiff(prevState, delta);
                    if (state !== null) this.states.setEndState(lineNumber, state);
                } else {
                    state = this.states.getEndState(lineNumber);
                }
                // Состояние предыдущей строки без разности — только если
                // воркер опередил нас (расхождение протокола); тогда дальше
                // этого блока доверять разностям нельзя.
                if (state === null) break;

                const current = toCurrent(lineNumber - 1);
                if (current !== undefined) {
                    // Only set the state if there is no future change in this line,
                    // as this might make consumers believe that the state/tokens are accurate
                    this.tokenStore.setEndState(current + 1, new TextMateState(state));
                }
                if (lineNumber >= lineCount - 1) this.tokenStore.backgroundTokenizationFinished();
                prevState = state;
            }
        }
        // First set states, then tokens, so that events fired from set tokens don't read invalid states
        this.tokenStore.setTokens(builder.finalize());
    }

    private sendModel(): void {
        this.send({
            type: "acceptNewModel",
            controllerId: this.controllerId,
            versionId: this.modelVersionId,
            text: this.document.getText(),
            scopeName: this.scopeName,
        });
    }
}

/** Upstream `TokenizationStateStore.acceptChanges` — по нашим 0-based правкам. */
function acceptChanges(store: TokenizationStateStore<StateStack>, changes: readonly IModelContentChange[]): void {
    for (const change of changes) {
        const [eolCount] = countEOL(change.text);
        store.acceptChange(new LineRange(change.range.start.line + 1, change.range.end.line + 2), eolCount + 1);
    }
}

/**
 * Строка (0-based) версии воркера → строка документа после всех будущих
 * правок; `undefined` — строку задела правка (upstream `MonotonousIndexTransformer`
 * над `linesLengthEditFromModelContentChange`: правка заменяет строки
 * `[start, end]` целиком).
 */
function transformLine(pendingChanges: readonly IModelContentChangedEvent[], lineIndex: number): number | undefined {
    let line = lineIndex;
    for (const event of pendingChanges) {
        for (const change of event.changes) {
            const { start, end } = change.range;
            if (line < start.line) continue;
            if (line <= end.line) return undefined;
            line += countEOL(change.text)[0] - (end.line - start.line);
        }
    }
    return line;
}
