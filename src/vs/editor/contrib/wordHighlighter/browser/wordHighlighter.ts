import { findFirstIdxMonotonousOrArrLen } from "../../../../base/common/arraysFind.ts";
import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import {
    clampPositionToDocument,
    comparePositions,
    type IPosition,
    positionsEqual,
} from "../../../common/core/iPosition.ts";
import type { IRange } from "../../../common/core/iRange.ts";
import { type ISelection, isSelectionCollapsed } from "../../../common/core/iSelection.ts";
import { findWordRangeAt } from "../../../common/core/wordClassification.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import {
    type DocumentHighlightProvider,
    EMPTY_WORD_HIGHLIGHT_SET,
    type IDocumentHighlight,
    textWordHighlightSet,
    wordHighlightSetOf,
} from "../../../common/languages/iDocumentHighlightSource.ts";
import type { EditorViewState } from "../../../common/viewModel/editorViewState.ts";
import { computeWordOccurrences } from "../../find/computeWordOccurrences.ts";

/** Upstream `WordHighlighter.runDelayer`: the query runs once the cursor settles. */
const RUN_DELAY_MS = 50;

/** `ranges` sorted; both ends count, as upstream `Range.containsPosition`. */
function sortedRangesContain(ranges: readonly IRange[], position: IPosition): boolean {
    const i = findFirstIdxMonotonousOrArrLen(ranges, (range) => comparePositions(range.end, position) >= 0);
    return i < ranges.length && comparePositions(ranges[i].start, position) <= 0;
}

function sameSelection(a: ISelection, b: ISelection): boolean {
    return positionsEqual(a.anchor, b.anchor) && positionsEqual(a.active, b.active);
}

/** Upstream `_run`: the selection is on one line and inside the word at its start, or surrounds exactly that word. */
function isWithinOneWord(viewState: EditorViewState, selection: ISelection): boolean {
    if (selection.anchor.line !== selection.active.line) return false;
    // A reload to a shorter text: the selections are remapped only after the document has changed.
    if (selection.active.line >= viewState.document.lineCount) return false;
    const [start, end] =
        selection.anchor.character <= selection.active.character
            ? [selection.anchor.character, selection.active.character]
            : [selection.active.character, selection.anchor.character];
    const word = findWordRangeAt(viewState.document.getLineContent(selection.active.line), start);
    return word !== null && end <= word.end;
}

/**
 * Port of upstream `WordHighlighter` for one file (`multiFile` is not supported): asks the document highlight
 * providers about the position under the cursor and falls back to the textual search. The set lives in
 * {@link EditorViewState.wordHighlights}, where the painters and F7 read it.
 *
 * A query is armed by the frame after the request, never in it: on a big file the textual search walks every
 * line, and the file shows its text first.
 */
export class WordHighlighter extends Disposable {
    private providers: LanguageFeatureRegistry<DocumentHighlightProvider> | null = null;
    private target: ILanguageFeatureTarget | null = null;
    private enabledValue = true;
    /** `editor.occurrencesHighlightDelay`. */
    public delay = 0;
    // The first query waits for the first frame.
    private runRequested = true;
    private runTimer: ReturnType<typeof setTimeout> | undefined;
    private renderTimer: ReturnType<typeof setTimeout> | undefined;
    private request: CancellationTokenSource | null = null;
    /** Set by {@link trigger}: this selection is queried whatever its shape, until it changes. */
    private forcedSelection: ISelection | null = null;
    /**
     * The cursor move of an edit (typing, Enter, undo) is not an explicit move: upstream keeps
     * the highlight off until the next one (`CursorChangeReason`). The edit and its cursor move
     * share one synchronous task, in either order: the view state remaps selections inside the
     * content event, before this class hears it. So a request made in the task of an edit is
     * withdrawn, and a cursor move after the edit in the same task makes none.
     */
    private task: { edited: boolean; requested: boolean } | null = null;

    public constructor(private readonly viewState: EditorViewState) {
        super();
        this.register(
            viewState.onDidChangeCursorPosition(() => {
                this.onCursorMoved();
            }),
        );
        this.register(
            viewState.document.onDidChangeContent(() => {
                this.onEdited();
            }),
        );
        this.register({
            dispose: () => {
                clearTimeout(this.runTimer);
                this.stop();
            },
        });
    }

    public setProviders(
        providers: LanguageFeatureRegistry<DocumentHighlightProvider>,
        target: ILanguageFeatureTarget,
    ): void {
        this.providers = providers;
        this.target = target;
    }

    public get enabled(): boolean {
        return this.enabledValue;
    }

    /** Off hides the set at once, on queries again with the next frame. */
    public set enabled(enabled: boolean) {
        this.enabledValue = enabled;
        this.runRequested = true;
        if (!enabled) this.stop();
    }

    /** Called by each frame; see the class comment. */
    public onFrame(): void {
        if (!this.runRequested) return;
        this.runRequested = false;
        clearTimeout(this.runTimer);
        this.runTimer = setTimeout(() => {
            this.run();
        }, RUN_DELAY_MS);
    }

    /**
     * `editor.action.wordHighlight.trigger`: asks about the current position right now, also with a selection
     * wider than a word and with the caret in a highlighted word. With several cursors there is nothing to ask.
     */
    public trigger(): void {
        const selections = this.viewState.selections;
        if (!this.enabledValue || selections.length !== 1) return;
        clearTimeout(this.runTimer);
        this.runRequested = false;
        this.stop();
        this.forcedSelection = selections[0];
        this.startQuery(selections[0].active, 0);
    }

    private currentTask(): { edited: boolean; requested: boolean } {
        if (this.task === null) {
            // Stryker disable next-line ObjectLiteral: `{}` reads both flags as undefined, i.e. false
            this.task = { edited: false, requested: false };
            queueMicrotask(() => {
                this.task = null;
            });
        }
        return this.task;
    }

    private onCursorMoved(): void {
        const selections = this.viewState.selections;
        if (
            this.forcedSelection !== null &&
            (selections.length !== 1 || !sameSelection(selections[0], this.forcedSelection))
        ) {
            this.forcedSelection = null;
        }
        const task = this.currentTask();
        if (!task.edited) {
            task.requested = true;
            this.runRequested = true;
        }
        // In the very frame a wide selection appears: a highlight would clash with it.
        if (this.queryPosition === null) this.stop();
    }

    /** Upstream `onDidChangeModelContent` → `_stopAll`. A query already armed stays: it reads the caret when it runs. */
    private onEdited(): void {
        this.forcedSelection = null;
        this.stop();
        const task = this.currentTask();
        task.edited = true;
        if (task.requested) this.runRequested = false;
    }

    /** Where to ask: no highlight with several cursors, or with a selection reaching out of one word. */
    private get queryPosition(): IPosition | null {
        const selections = this.viewState.selections;
        if (!this.enabledValue || selections.length !== 1) return null;
        const selection = selections[0];
        if (this.forcedSelection === null && !isWithinOneWord(this.viewState, selection)) return null;
        return selection.active;
    }

    /** Upstream `_run`: a caret still inside a highlighted word keeps the set, without a request. */
    private run(): void {
        const position = this.queryPosition;
        if (position === null) {
            this.stop();
            return;
        }
        if (sortedRangesContain(this.viewState.wordHighlights.ranges, position)) return;
        this.stop();
        this.startQuery(position, this.delay);
    }

    private startQuery(position: IPosition, delay: number): void {
        const renderAt = Date.now() + delay;
        const target = this.target;
        const providers = target === null ? [] : (this.providers?.ordered(target) ?? []);
        // Synchronous without providers: an extra task per cursor move buys nothing.
        if (target === null || providers.length === 0) {
            this.renderTextual(position, renderAt);
            return;
        }
        const request = new CancellationTokenSource();
        this.request = request;
        void this.askProviders(providers, target, position, renderAt, request);
    }

    private async askProviders(
        providers: readonly DocumentHighlightProvider[],
        target: ILanguageFeatureTarget,
        position: IPosition,
        renderAt: number,
        request: CancellationTokenSource,
    ): Promise<void> {
        const document = this.viewState.document;
        const versionId = document.versionId;
        const highlights = await this.firstAnswer(providers, target, position, versionId, request.token);
        // Superseded, or the text or the caret moved under the answer: the move has scheduled the next query.
        if (
            request.token.isCancellationRequested ||
            document.versionId !== versionId ||
            !positionsEqual(this.viewState.selections[0].active, position)
        ) {
            return;
        }
        this.request = null;
        if (highlights === null) {
            this.renderTextual(position, renderAt);
            return;
        }
        this.render(() => {
            this.viewState.wordHighlights = wordHighlightSetOf(this.normalized(highlights));
        }, renderAt);
    }

    /** Upstream `getOccurrencesAtPosition`: an empty array is an answer too, only `null` asks the next provider. */
    private async firstAnswer(
        providers: readonly DocumentHighlightProvider[],
        target: ILanguageFeatureTarget,
        position: IPosition,
        versionId: number,
        token: ICancellationToken,
    ): Promise<readonly IDocumentHighlight[] | null> {
        const request = { uri: target.uri.toString(), languageId: target.languageId, versionId, position };
        for (const provider of providers) {
            try {
                const highlights = await provider.provideDocumentHighlights(request, token);
                if (highlights !== null) return highlights;
            } catch (e) {
                onUnexpectedError(e);
            }
            if (token.isCancellationRequested) return null;
        }
        return null;
    }

    /** A provider's ranges come in any order and may lie past the text of this version. */
    private normalized(highlights: readonly IDocumentHighlight[]): IDocumentHighlight[] {
        const document = this.viewState.document;
        return highlights
            .map(({ range, kind }) => ({
                kind,
                range: {
                    start: clampPositionToDocument(document, range.start),
                    end: clampPositionToDocument(document, range.end),
                },
            }))
            .sort((a, b) => comparePositions(a.range.start, b.range.start));
    }

    private renderTextual(position: IPosition, renderAt: number): void {
        this.render(() => {
            this.viewState.wordHighlights = textWordHighlightSet(
                computeWordOccurrences(this.viewState.document, position),
            );
        }, renderAt);
    }

    /** Upstream `_beginRenderDecorations`: not before the configured delay, counted from the start of the query. */
    private render(publish: () => void, renderAt: number): void {
        const wait = renderAt - Date.now();
        if (wait <= 0) {
            publish();
            return;
        }
        this.renderTimer = setTimeout(publish, wait);
    }

    /** Upstream `_stopAll`. */
    private stop(): void {
        clearTimeout(this.renderTimer);
        this.request?.cancel();
        this.request = null;
        this.viewState.wordHighlights = EMPTY_WORD_HIGHLIGHT_SET;
    }
}
