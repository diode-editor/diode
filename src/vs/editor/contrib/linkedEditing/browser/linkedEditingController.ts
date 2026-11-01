import { CancellationTokenSource, type ICancellationToken } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { comparePositions, type IPosition, positionsEqual } from "../../../common/core/iPosition.ts";
import { createRange, type IRange } from "../../../common/core/iRange.ts";
import { createTextEdit, type ITextEdit } from "../../../common/core/iTextEdit.ts";
import { DEFAULT_WORD_REGEXP } from "../../../common/core/wordHelper.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type {
    ILinkedEditingRanges,
    LinkedEditingRangeProvider,
} from "../../../common/languages/iLinkedEditingSource.ts";
import type { IModelContentChangedEvent } from "../../../common/model/iDocumentContentChange.ts";
import { TrackedRangeStickiness } from "../../../common/model/trackedDecorations.ts";
import type { FeatureDebounce } from "../../../common/services/languageFeatureDebounce.ts";
import type { EditorViewState } from "../../../common/viewModel/editorViewState.ts";

const DECORATION = {
    description: "linked-editing",
    stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
};

/** What the controller needs of a text editor pane. */
export interface ILinkedEditingEditor extends ILanguageFeatureTarget {
    readonly viewState: EditorViewState;
    applyEditsIntoLastUndoStep(edits: readonly ITextEdit[], label: string): void;
    onDidChangeCursorPosition(listener: () => void): IDisposable;
}

export interface ILinkedEditingOptions {
    readonly providers: LanguageFeatureRegistry<LinkedEditingRangeProvider>;
    /** `editor.linkedEditing` for the editor's language. */
    isSettingEnabled(): boolean;
    /** `undefined`: not loaded yet, or the language has none. */
    languageWordPattern(languageId: string): RegExp | undefined;
    /** Upstream `languageFeatureDebounceService.for(providers, "Linked Editing", { max: 200 })`. */
    readonly debounce: FeatureDebounce;
}

function containsPosition(range: IRange, position: IPosition): boolean {
    return comparePositions(range.start, position) <= 0 && comparePositions(position, range.end) <= 0;
}

/** Upstream `Range.intersectRanges` is not null: ranges that only touch intersect too. */
function touches(a: IRange, b: IRange): boolean {
    return comparePositions(a.start, b.end) <= 0 && comparePositions(b.start, a.end) <= 0;
}

/** A search, not a counting loop: a mutated counter would hang the whole gate (docs/MUTATION.md). */
function commonPrefixLength(a: string, b: string): number {
    const firstDifference = a.split("").findIndex((char, i) => char !== b[i]);
    return firstDifference < 0 ? a.length : firstDifference;
}

function reversed(text: string): string {
    return text.split("").reverse().join("");
}

/**
 * Upstream `_syncRanges`: only what differs is replaced, so the rest keeps its markers. The new value is one line, so
 * the common parts never cross a line break, and a mirror over several lines needs no branch of its own.
 */
function minimalEdit(range: IRange, oldValue: string, newValue: string): ITextEdit | null {
    const prefix = commonPrefixLength(oldValue, newValue);
    const oldRest = oldValue.slice(prefix);
    const newRest = newValue.slice(prefix);
    const suffix = commonPrefixLength(reversed(oldRest), reversed(newRest));
    const startCharacter = range.start.character + prefix;
    const endCharacter = range.end.character - suffix;
    const text = newRest.slice(0, newRest.length - suffix);
    if (startCharacter === endCharacter && text.length === 0) return null;
    return createTextEdit(createRange(range.start.line, startCharacter, range.end.line, endCharacter), text);
}

/**
 * Port of upstream `LinkedEditingContribution` for the active editor.
 *
 * One deviation: upstream subscribes to the editor only while the setting is on, so its Start Linked Editing with
 * the setting off lights the ranges up and nothing follows. Here the subscriptions stay, so the ranges of the command
 * mirror like any other; with the setting off they are simply not asked for again once they are gone.
 */
export class LinkedEditingController extends Disposable {
    // Stryker disable next-line BooleanLiteral: the constructor's reinitialize sets it before anything reads it
    private enabled = false;
    /** The one at index 0 is the reference. */
    // Stryker disable next-line ArrayDeclaration: the constructor's reinitialize clears them, a foreign id removes nothing
    private decorationIds: string[] = [];
    private wordPattern: RegExp = DEFAULT_WORD_REGEXP;
    /** A new set of ranges cancels a sync still waiting for its timer. */
    private syncToken = 0;
    private updateTimer: ReturnType<typeof setTimeout> | undefined;
    private request: CancellationTokenSource | null = null;
    private requestPosition: IPosition | null = null;
    private requestVersion: number | null = null;

    public constructor(
        private readonly editor: ILinkedEditingEditor,
        private readonly options: ILinkedEditingOptions,
    ) {
        super();
        this.register(
            editor.onDidChangeCursorPosition(() => {
                this.scheduleUpdate();
            }),
        );
        this.register(
            editor.viewState.document.onDidChangeModelContent((event) => {
                this.onContentChanged(event);
            }),
        );
        this.register({
            dispose: () => {
                clearTimeout(this.updateTimer);
                this.clearRanges();
            },
        });
        // Stryker disable next-line BooleanLiteral: on or off, the first call has no ranges and asks if it may
        this.reinitialize(true);
    }

    /** Upstream `reinitialize`: the setting, the providers or the language changed. */
    public reinitialize(forceRefresh: boolean): void {
        const enabled = this.options.isSettingEnabled() && this.options.providers.has(this.editor);
        if (enabled === this.enabled && !forceRefresh) return;
        this.enabled = enabled;
        this.clearRanges();
        void this.updateRanges();
    }

    /** Upstream `clearRanges`: Escape, a break-out, or a caret that left the ranges. */
    public clearRanges(): void {
        this.request?.cancel();
        this.request = null;
        this.requestPosition = null;
        if (this.decorationIds.length === 0) return;
        this.decorationIds = this.editor.viewState.document.deltaDecorations(this.decorationIds, []);
        this.publishRanges();
    }

    /** `force`: `editor.action.linkedEditing`, which works with the setting off too. */
    public async updateRanges(force = false): Promise<void> {
        const viewState = this.editor.viewState;
        const selections = viewState.selections;
        if (selections.length > 1) {
            this.clearRanges();
            return;
        }
        const position = selections[0].active;
        const versionId = viewState.document.versionId;
        const reference = this.currentRanges().at(0);
        if (!force && this.requestPosition !== null && this.requestVersion === versionId) {
            if (positionsEqual(position, this.requestPosition)) return;
            if (reference !== undefined && containsPosition(reference, position)) return;
        }
        if (reference === undefined || !containsPosition(reference, position)) {
            this.clearRanges();
            // The ranges of the command end here: with the setting off nothing asks again.
            if (!this.enabled && !force) return;
        }
        this.requestPosition = position;
        this.requestVersion = versionId;
        this.request?.cancel();
        const request = new CancellationTokenSource();
        this.request = request;

        const startedAt = Date.now();
        const key = this.editor.uri.toString();
        const response = await this.firstAnswer(position, versionId, request.token);
        this.options.debounce.update(key, Date.now() - startedAt);
        if (request !== this.request) return;
        this.request = null;
        // The edit has scheduled the next query.
        if (versionId !== viewState.document.versionId) return;
        this.applyResponse(response, position);
    }

    /** Upstream `getLinkedEditingRanges`: the first provider with ranges, in the order of the score. */
    private async firstAnswer(
        position: IPosition,
        versionId: number,
        token: ICancellationToken,
    ): Promise<ILinkedEditingRanges | null> {
        const request = {
            uri: this.editor.uri.toString(),
            languageId: this.editor.languageId,
            versionId,
            position,
        };
        for (const provider of this.options.providers.ordered(this.editor)) {
            try {
                const answer = await provider.provideLinkedEditingRanges(request, token);
                if (answer !== null && answer.ranges.length > 0) return answer;
            } catch (e) {
                onUnexpectedError(e);
            }
            if (token.isCancellationRequested) return null;
        }
        return null;
    }

    private applyResponse(response: ILinkedEditingRanges | null, position: IPosition): void {
        if (response === null) {
            this.clearRanges();
            return;
        }
        const { ranges } = response;
        const referenceIndex = ranges.findIndex((range) => containsPosition(range, position));
        // Cannot do linked editing if the ranges are not where the cursor is.
        if (referenceIndex < 0) {
            this.clearRanges();
            return;
        }
        this.wordPattern =
            response.wordPattern ?? this.options.languageWordPattern(this.editor.languageId) ?? DEFAULT_WORD_REGEXP;
        const ordered = [ranges[referenceIndex], ...ranges.filter((_, i) => i !== referenceIndex)];
        this.decorationIds = this.editor.viewState.document.deltaDecorations(
            this.decorationIds,
            ordered.map((range) => ({ range, options: DECORATION })),
        );
        // Stryker disable next-line UpdateOperator: the token only has to differ
        this.syncToken++;
        this.publishRanges();
    }

    private scheduleUpdate(): void {
        clearTimeout(this.updateTimer);
        this.updateTimer = setTimeout(() => {
            void this.updateRanges();
        }, this.options.debounce.get(this.editor.uri.toString()));
    }

    private onContentChanged(event: IModelContentChangedEvent): void {
        this.publishRanges();
        const reference = this.currentRanges().at(0);
        if (
            reference !== undefined &&
            !event.isFlush &&
            event.changes.every((change) => touches(reference, change.range))
        ) {
            const token = this.syncToken;
            setTimeout(() => {
                this.syncRanges(token);
            }, 0);
            return;
        }
        this.scheduleUpdate();
    }

    /** Upstream `_syncRanges`, on a timer of its own: the edit has finished, its cursor move included. */
    private syncRanges(token: number): void {
        const ranges = this.currentRanges();
        const reference = ranges.at(0);
        // Stryker disable next-line MethodExpression: the reference against itself gives no edit
        const mirrors = ranges.slice(1);
        if (token !== this.syncToken || reference === undefined) return;
        const document = this.editor.viewState.document;
        if (reference.start.line !== reference.end.line) {
            this.clearRanges();
            return;
        }
        const referenceValue = document.getTextInRange(reference);
        const match = referenceValue.match(this.wordPattern);
        if ((match === null ? 0 : match[0].length) !== referenceValue.length) {
            this.clearRanges();
            return;
        }
        const edits: ITextEdit[] = [];
        for (const mirror of mirrors) {
            const edit = minimalEdit(mirror, document.getTextInRange(mirror), referenceValue);
            if (edit !== null) edits.push(edit);
        }
        if (edits.length === 0) return;
        // Its own event needs no guard: a sync after it finds the texts equal and edits nothing.
        this.editor.applyEditsIntoLastUndoStep(edits, "linkedEditing");
    }

    /** Where the decorations are now, the reference first. */
    private currentRanges(): IRange[] {
        const document = this.editor.viewState.document;
        const ranges: IRange[] = [];
        for (const id of this.decorationIds) {
            const range = document.getDecorationRange(id);
            // Stryker disable next-line ConditionalExpression: only this class removes its ids, null guards a foreign one
            if (range !== null) ranges.push(range);
        }
        return ranges;
    }

    /** The painter wants them sorted, and a mirror may lie before the reference. */
    private publishRanges(): void {
        this.editor.viewState.linkedEditingRanges = this.currentRanges().sort((a, b) =>
            comparePositions(a.start, b.start),
        );
    }
}
