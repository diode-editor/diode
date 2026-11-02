import { segmentGraphemes } from "@tuidom/core/common/segmentGraphemes";

import { assert } from "../../../../base/common/assert.ts";
import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import type { Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import { StopWatch } from "../../../../base/common/stopwatch.ts";
import { isHighSurrogate, isLowSurrogate } from "../../../../base/common/strings.ts";
import type { IRange } from "../../../common/core/iRange.ts";
import { charClass, isWordChar } from "../../../common/core/wordClassification.ts";
import type { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import {
    type IInlayHintsTarget,
    type InlayHint,
    InlayHintKind,
    type InlayHintList,
    type InlayHintsProvider,
} from "../../../common/languages/iInlayHintsSource.ts";
import type { IInlineInsertion } from "../../../common/model/iInlineInsertion.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import { TrackedRangeStickiness } from "../../../common/model/trackedDecorations.ts";
import { FeatureDebounce } from "../../../common/services/languageFeatureDebounce.ts";

/** Upstream `_MAX_DECORATORS`; here it counts hints, each hint being up to three insertions. */
export const MAX_INLAY_HINTS = 1500;

/** Upstream `languageFeatureDebounceService.for(inlayHintsProvider, 'InlayHint', { min: 25 })`. */
const RECOMPUTE_MIN_DELAY = 25;
/** Upstream's default `max` is `min ** 2`. */
const RECOMPUTE_MAX_DELAY = RECOMPUTE_MIN_DELAY ** 2;
const inlayHintsDebounce = new FeatureDebounce(RECOMPUTE_MIN_DELAY, RECOMPUTE_MAX_DELAY);

const NO_WINDOW = { startLine: 0, endLine: -1 };

export type InlayHintsFontStyle = "normal" | "italic" | "dim";

export interface IInlayHintsOptions {
    /** `editor.inlayHints.enabled` after the session toggle: the "pressed" modes are already folded into on/off. */
    readonly enabled: boolean;
    readonly padding: boolean;
    readonly maximumLength: number;
    readonly fontStyle: InlayHintsFontStyle;
}

export const DEFAULT_INLAY_HINTS_OPTIONS: IInlayHintsOptions = {
    enabled: true,
    padding: false,
    maximumLength: 43,
    fontStyle: "normal",
};

export interface IInlayHintsModel extends IInlayHintsTarget {
    readonly onDidChangeLanguage: Event<unknown>;
}

export interface IInlayHintsViewport {
    /** Document lines, inclusive. */
    getVisibleLineRange(): { readonly startLine: number; readonly endLine: number };
    readonly onDidChangeVisibleRange: Event<void>;
}

interface IDecorator {
    readonly id: string;
    readonly hint: InlayHint;
    /** Segmented once: `editor.inlayHints.maximumLength` counts what the user sees, not UTF-16 units. */
    readonly graphemes: readonly string[];
}

/** A provider's failure to clean up costs nobody else their hints. */
function disposeList(list: InlayHintList): void {
    try {
        list.dispose();
    } catch (e) {
        onUnexpectedError(e);
    }
}

/** Upstream `validatePosition`: past the line end clamps to it, inside a surrogate pair moves before the pair. */
function validCharacter(document: ITextDocument, line: number, character: number): number {
    const content = document.getLineContent(line);
    const clamped = Math.max(0, Math.min(character, content.length));
    // Off either end of the line `charCodeAt` is NaN, which is no surrogate.
    const inPair = isHighSurrogate(content.charCodeAt(clamped - 1)) && isLowSurrogate(content.charCodeAt(clamped));
    return inPair ? clamped - 1 : clamped;
}

/** A label is one line of cells: upstream's DOM collapses a newline and keeps a tab as a space (`fixSpace`). */
function labelGraphemes(hint: InlayHint): readonly string[] {
    const label = typeof hint.label === "string" ? hint.label : hint.label.map((part) => part.label).join("");
    return Array.from(segmentGraphemes(label.replace(/[\t\r\n]/g, " ")), (grapheme) => grapheme.segment);
}

function colorTokensOf(kind: InlayHintKind | undefined): { readonly fg: string; readonly bg: string } {
    switch (kind) {
        case InlayHintKind.Type:
            return { fg: "editorInlayHint.typeForeground", bg: "editorInlayHint.typeBackground" };
        case InlayHintKind.Parameter:
            return { fg: "editorInlayHint.parameterForeground", bg: "editorInlayHint.parameterBackground" };
        case undefined:
            return { fg: "editorInlayHint.foreground", bg: "editorInlayHint.background" };
    }
}

/**
 * Port of upstream `InlayHintsController` without the mouse gestures, the tab-switch cache, the modifier keys
 * and `resolveInlayHint` (docs/TODO/InlayHintsCodeLens.md). Asks the providers for the visible lines plus a
 * viewport above and below; each hint is a collapsed tracked decoration, so it follows the text until the
 * next answer replaces it.
 */
/**
 * Counterpart of upstream `InlayHintAnchor.direction`. A hint leading the text after it (a parameter
 * name before an argument) lets the block caret stand on that text's first character. A hint
 * trailing a word (a type after a name) or ending the visible text keeps the caret left of it, so
 * the caret stays next to what is being typed.
 */
function hintLeadsText(lineContent: string, offset: number): boolean {
    if (offset >= lineContent.length || charClass(lineContent[offset]) === 0) return false;
    return offset === 0 || !isWordChar(lineContent[offset - 1]);
}

export class InlayHintsController extends Disposable {
    private readonly session = this.register(new DisposableStore());
    private readonly scheduler: RunOnceScheduler;
    private request: CancellationTokenSource | null = null;
    /** Empty until the first request. */
    private requestedWindow: { readonly startLine: number; readonly endLine: number } = NO_WINDOW;
    // Stryker disable next-line ArrayDeclaration: a decorator without an id has no range and draws nothing
    private decorators: readonly IDecorator[] = [];
    private lists: readonly InlayHintList[] = [];

    public constructor(
        private readonly model: IInlayHintsModel,
        private readonly viewport: IInlayHintsViewport,
        private readonly registry: LanguageFeatureRegistry<InlayHintsProvider>,
        private options: IInlayHintsOptions,
        private readonly onDidChangeInsertions: (insertions: readonly IInlineInsertion[]) => void,
    ) {
        super();
        this.scheduler = this.register(
            new RunOnceScheduler(() => {
                void this.compute();
            }, RECOMPUTE_MIN_DELAY),
        );
        this.register(
            model.onDidChangeLanguage(() => {
                this.update();
            }),
        );
        this.register(
            registry.onDidChange(() => {
                this.update();
            }),
        );
        // The document moves the decorations before its events: the hints follow the text at once.
        this.register(
            model.document.onDidChangeModelContent(() => {
                // Stryker disable next-line ConditionalExpression,EqualityOperator: publishing no hints again changes nothing on the frame
                if (this.decorators.length > 0) this.publish();
            }),
        );
        this.register({
            dispose: () => {
                this.stop();
                // Stryker disable next-line ArrayDeclaration: only the decorations of the closing editor are dropped here, nothing paints after
                this.replaceHints([], []);
            },
        });
        this.update();
    }

    /** Looks apply at once, from the hints already held; the providers are asked again, as upstream does. */
    public setOptions(options: IInlayHintsOptions): void {
        const previous = this.options;
        this.options = options;
        if (previous.enabled !== options.enabled) {
            this.update();
            return;
        }
        if (
            previous.padding === options.padding &&
            previous.maximumLength === options.maximumLength &&
            previous.fontStyle === options.fontStyle
        ) {
            return;
        }
        // Stryker disable next-line ConditionalExpression,EqualityOperator: publishing no hints again changes nothing on the frame
        if (this.decorators.length > 0) this.publish();
        // Stryker disable next-line ConditionalExpression: when off, an edit subscription is absent and a request would only be dropped by `compute`
        if (options.enabled) this.scheduleCompute();
    }

    private update(): void {
        this.stop();
        if (!this.options.enabled || !this.registry.has(this.model)) {
            this.replaceHints([], []);
            return;
        }
        this.session.add(
            this.model.document.onDidChangeModelContent(() => {
                // Its answer would describe the text before the edit; the hints on screen have moved already.
                this.request?.cancel();
                this.scheduleCompute();
            }),
        );
        this.session.add(
            this.viewport.onDidChangeVisibleRange(() => {
                if (this.isVisibleRangeRequested() || this.scheduler.isScheduled()) return;
                this.scheduleCompute();
            }),
        );
        for (const provider of this.registry.ordered(this.model)) {
            const event = provider.onDidChangeInlayHints;
            if (event === undefined) continue;
            this.session.add(
                event(() => {
                    this.scheduleCompute();
                }),
            );
        }
        // Upstream's `scheduler.schedule(0)`: an editor is built before its document reaches the extension host, and a
        // request sent now would be answered "not synced" with nothing to ask again.
        this.scheduler.schedule(0);
    }

    private scheduleCompute(): void {
        this.scheduler.schedule(inlayHintsDebounce.get(this.model.uri.toString()));
    }

    /** Upstream `getVisibleRangesPlusViewportAboveBelow`. */
    private computeWindow(): { readonly startLine: number; readonly endLine: number } {
        const { startLine, endLine } = this.viewport.getVisibleLineRange();
        const height = endLine - startLine + 1;
        return {
            startLine: Math.max(0, startLine - height),
            endLine: Math.min(this.model.document.lineCount - 1, endLine + height),
        };
    }

    private isVisibleRangeRequested(): boolean {
        const { startLine, endLine } = this.viewport.getVisibleLineRange();
        return startLine >= this.requestedWindow.startLine && endLine <= this.requestedWindow.endLine;
    }

    private async compute(): Promise<void> {
        this.request?.cancel();
        const request = new CancellationTokenSource();
        this.request = request;
        const document = this.model.document;
        const window = this.computeWindow();
        this.requestedWindow = window;
        const range: IRange = {
            start: { line: window.startLine, character: 0 },
            end: { line: window.endLine, character: document.getLineLength(window.endLine) },
        };
        // Stryker disable next-line BooleanLiteral: the resolution of the timer is not observable in a debounce of tens of ms
        const sw = new StopWatch(false);
        const answers = await Promise.all(
            this.registry.ordered(this.model).map(async (provider) => {
                try {
                    return await provider.provideInlayHints(this.model, range, request.token);
                } catch (e) {
                    // One provider's failure must not cost the others their hints.
                    onUnexpectedError(e);
                    return null;
                }
            }),
        );
        const lists = answers.filter((list) => list !== null && list !== undefined);
        // Superseded, stopped, or the text moved under the answer (an edit cancels the request): whoever did that has
        // scheduled the next one.
        if (request.token.isCancellationRequested) {
            for (const list of lists) disposeList(list);
            return;
        }
        this.request = null;
        inlayHintsDebounce.update(this.model.uri.toString(), sw.elapsed());
        this.replaceHints(
            lists.flatMap((list) => list.hints),
            lists,
        );
    }

    private stop(): void {
        this.scheduler.cancel();
        this.request?.cancel();
        this.request = null;
        this.requestedWindow = NO_WINDOW;
        this.session.clear();
    }

    /** Sorted by position, a stable sort: at one offset the provider order stays. The limit keeps the first hints. */
    private replaceHints(hints: readonly InlayHint[], lists: readonly InlayHintList[]): void {
        const document = this.model.document;
        const shown = hints
            .filter(
                (hint) =>
                    hint.position.line >= 0 &&
                    hint.position.line < document.lineCount &&
                    labelGraphemes(hint).length > 0,
            )
            .map((hint) => ({
                hint,
                graphemes: labelGraphemes(hint),
                position: {
                    line: hint.position.line,
                    character: validCharacter(document, hint.position.line, hint.position.character),
                },
            }))
            .sort((a, b) => a.position.line - b.position.line || a.position.character - b.position.character)
            .slice(0, MAX_INLAY_HINTS);
        const ids = document.deltaDecorations(
            this.decorators.map((decorator) => decorator.id),
            shown.map(({ position }) => ({
                range: { start: position, end: position },
                options: {
                    // Stryker disable next-line StringLiteral: the description only names the decoration in a debugger
                    description: "inlayHints",
                    // Typing at the hint's point goes left of it: both edges of the collapsed range move right.
                    stickiness: TrackedRangeStickiness.GrowsOnlyWhenTypingAfter,
                },
            })),
        );
        this.decorators = ids.map((id, i) => ({ id, hint: shown[i].hint, graphemes: shown[i].graphemes }));
        for (const list of this.lists) disposeList(list);
        this.lists = lists;
        this.publish();
    }

    private publish(): void {
        const { maximumLength } = this.options;
        const insertions: IInlineInsertion[] = [];
        // Stryker disable next-line UnaryOperator: the length starts at 0, so meeting the first line "again" resets nothing
        let line = -1;
        let lineLength = 0;
        for (const decorator of this.decorators) {
            const range = this.model.document.getDecorationRange(decorator.id);
            // Our ids live until we remove them.
            assert(range !== null);
            if (range.start.line !== line) {
                line = range.start.line;
                lineLength = 0;
            }
            // Upstream: once a line is over the limit, its later hints are not drawn; 0 means no limit.
            if (maximumLength !== 0 && lineLength > maximumLength) continue;
            lineLength += decorator.graphemes.length;
            const over = maximumLength !== 0 ? lineLength - maximumLength : 0;
            const label = over > 0 ? `${decorator.graphemes.slice(0, -over).join("")}…` : decorator.graphemes.join("");
            this.pushHint(insertions, decorator.hint, line, range.start.character, label);
        }
        this.onDidChangeInsertions(insertions);
    }

    /** The outer padding keeps the line's background; the inner one belongs to the pill. */
    private pushHint(
        insertions: IInlineInsertion[],
        hint: InlayHint,
        line: number,
        offset: number,
        label: string,
    ): void {
        const base: Pick<IInlineInsertion, "line" | "offset" | "caretSide" | "outsideRangeBackgrounds"> = {
            line,
            offset,
            ...(hintLeadsText(this.model.document.getLineContent(line), offset) ? { caretSide: "right" } : {}),
            outsideRangeBackgrounds: true,
        };
        if (hint.paddingLeft === true) insertions.push({ ...base, text: " " });
        const { fg, bg } = colorTokensOf(hint.kind);
        const { padding, fontStyle } = this.options;
        insertions.push({
            ...base,
            text: padding ? ` ${label} ` : label,
            colorToken: fg,
            bgToken: bg,
            italic: fontStyle === "italic",
            dim: fontStyle === "dim",
        });
        if (hint.paddingRight === true) insertions.push({ ...base, text: " " });
    }
}
