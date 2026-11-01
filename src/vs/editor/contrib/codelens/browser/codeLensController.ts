import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { renderCodicons } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import type { Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import { StopWatch } from "../../../../base/common/stopwatch.ts";
import type { IRange } from "../../../common/core/iRange.ts";
import type { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type {
    CodeLens,
    CodeLensCommand,
    CodeLensList,
    CodeLensProvider,
    ICodeLensAction,
    ICodeLensTarget,
    ICodeLensZone,
} from "../../../common/languages/iCodeLensSource.ts";
import { TrackedRangeStickiness } from "../../../common/model/trackedDecorations.ts";
import { FeatureDebounce } from "../../../common/services/languageFeatureDebounce.ts";

/** Upstream `languageFeatureDebounceService.for(codeLensProvider, 'CodeLensProvide' | 'CodeLensResolve', { min: 250 })`. */
const MIN_DELAY = 250;
/** Upstream's default `max` is `min ** 2`. */
const MAX_DELAY = MIN_DELAY ** 2;
const provideDebounce = new FeatureDebounce(MIN_DELAY, MAX_DELAY);
const resolveDebounce = new FeatureDebounce(MIN_DELAY, MAX_DELAY);

/** Upstream's text when every lens of a line has fallen off. */
const NO_COMMANDS = "no commands";
const SEPARATOR = " | ";

export interface ICodeLensOptions {
    /** `editor.codeLens`. */
    readonly enabled: boolean;
    /** Which glyph set `$(icon)` in a title expands to. */
    readonly nerdFont: boolean;
}

export const DEFAULT_CODE_LENS_OPTIONS: ICodeLensOptions = { enabled: true, nerdFont: false };

/** A row of the picker: the title as the lens row shows it. */
export interface ICodeLensPick {
    readonly label: string;
    readonly command: CodeLensCommand;
}

export interface ICodeLensModel extends ICodeLensTarget {
    readonly onDidChangeLanguage: Event<unknown>;
}

export interface ICodeLensViewport {
    /** Document lines, inclusive. */
    getVisibleLineRange(): { readonly startLine: number; readonly endLine: number };
    readonly onDidChangeVisibleRange: Event<void>;
}

interface ILensItem {
    readonly id: string;
    readonly provider: CodeLensProvider;
    /** Whether a collapse of the tracked range means its text is gone. */
    readonly nonEmptyAtStart: boolean;
    lens: CodeLens;
    /** `waiting` — a resolve is still due; `failed` — the resolve threw or answered nothing. */
    state: "waiting" | "settled" | "failed";
}

/** A provider's failure to clean up costs nobody else their lenses. */
function disposeList(list: CodeLensList): void {
    try {
        list.dispose();
    } catch (e) {
        onUnexpectedError(e);
    }
}

/** A title is one line of cells; upstream trims it and its DOM collapses a line break. */
function titleText(command: CodeLensCommand, nerdFont: boolean): string {
    return renderCodicons(command.title, nerdFont)
        .replace(/[\t\r\n]/g, " ")
        .trim();
}

/**
 * Port of upstream `CodeLensContribution` without the storage cache and the focus triggers. Every lens is a tracked
 * decoration, so it follows the text until the next answer replaces it. The zones go to `onDidChangeZones`.
 */
export class CodeLensController extends Disposable {
    private readonly session = this.register(new DisposableStore());
    private readonly provideScheduler: RunOnceScheduler;
    private readonly resolveScheduler: RunOnceScheduler;
    private provideRequest: CancellationTokenSource | null = null;
    private resolveRequest: CancellationTokenSource | null = null;
    /** What the quick pick awaits, as upstream's `getModel`. */
    private providing: Promise<void> = Promise.resolve();
    private resolving: Promise<void> = Promise.resolve();
    // Stryker disable next-line ArrayDeclaration: an item without an id has no range and draws nothing
    private items: ILensItem[] = [];
    private lists: readonly CodeLensList[] = [];
    private publishQueued = false;
    private isDisposedController = false;

    public constructor(
        private readonly model: ICodeLensModel,
        private readonly viewport: ICodeLensViewport,
        private readonly registry: LanguageFeatureRegistry<CodeLensProvider>,
        private options: ICodeLensOptions,
        private readonly onDidChangeZones: (zones: readonly ICodeLensZone[]) => void,
    ) {
        super();
        this.provideScheduler = this.register(
            new RunOnceScheduler(() => {
                this.providing = this.provide();
            }, MIN_DELAY),
        );
        this.resolveScheduler = this.register(
            new RunOnceScheduler(() => {
                this.resolving = this.resolveVisible();
            }, MIN_DELAY),
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
        this.register({
            dispose: () => {
                this.isDisposedController = true;
                this.stop();
                // Stryker disable next-line ArrayDeclaration: nothing disposes the lists of a disposed controller
                this.replaceItems([], []);
            },
        });
        this.update();
    }

    public setOptions(options: ICodeLensOptions): void {
        const previous = this.options;
        this.options = options;
        if (previous.enabled !== options.enabled) this.update();
        else if (previous.nerdFont !== options.nerdFont) this.publish();
    }

    /** Lenses of the line with a title to show, after whatever is in flight has answered. */
    public async getPicksAtLine(line: number): Promise<readonly ICodeLensPick[]> {
        await this.providing;
        await this.resolving;
        const document = this.model.document;
        const picks: ICodeLensPick[] = [];
        for (const item of this.items) {
            const command = item.lens.command;
            if (command === undefined || document.getDecorationRange(item.id)?.start.line !== line) continue;
            const label = titleText(command, this.options.nerdFont);
            if (label !== "") picks.push({ label, command });
        }
        return picks;
    }

    /** Upstream `_onModelChange`: everything on screen goes, and the providers are asked after the debounce. */
    private update(): void {
        this.stop();
        this.replaceItems([], []);
        if (!this.options.enabled || !this.registry.has(this.model)) return;
        this.session.add(
            this.model.document.onDidChangeModelContent(() => {
                // Their answers would describe the text before the edit; the lenses on screen have moved already.
                this.cancelRequests();
                this.resolveScheduler.cancel();
                this.dropCollapsed();
                this.publishAfterEdit();
                this.provideScheduler.schedule(provideDebounce.get(this.key));
            }),
        );
        this.session.add(
            this.viewport.onDidChangeVisibleRange(() => {
                if (this.hasWaitingInView()) this.scheduleResolve();
            }),
        );
        for (const provider of this.registry.ordered(this.model)) {
            const event = provider.onDidChange;
            if (event === undefined) continue;
            this.session.add(
                event(() => {
                    this.provideScheduler.schedule(provideDebounce.get(this.key));
                }),
            );
        }
        this.provideScheduler.schedule(provideDebounce.get(this.key));
    }

    // Stryker disable next-line BlockStatement: one shared key only averages the debounce of all documents, a tuning
    private get key(): string {
        return this.model.uri.toString();
    }

    private scheduleResolve(): void {
        this.resolveScheduler.schedule(resolveDebounce.get(this.key));
    }

    private cancelRequests(): void {
        this.provideRequest?.cancel();
        this.provideRequest = null;
        this.resolveRequest?.cancel();
        this.resolveRequest = null;
    }

    private stop(): void {
        this.provideScheduler.cancel();
        this.resolveScheduler.cancel();
        this.cancelRequests();
        this.session.clear();
    }

    private async provide(): Promise<void> {
        this.provideRequest?.cancel();
        const request = new CancellationTokenSource();
        this.provideRequest = request;
        // Stryker disable next-line BooleanLiteral: the resolution of the timer is not observable in a debounce of hundreds of ms
        const sw = new StopWatch(false);
        const providers = this.registry.ordered(this.model);
        const answers = await Promise.all(
            providers.map(async (provider) => {
                try {
                    return await provider.provideCodeLenses(this.model, request.token);
                } catch (e) {
                    // One provider's failure must not cost the others their lenses.
                    onUnexpectedError(e);
                    return null;
                }
            }),
        );
        const lists = answers.filter((list) => list !== null && list !== undefined);
        // Superseded, stopped, or the text moved under the answer: whoever did that has scheduled the next one.
        if (request.token.isCancellationRequested) {
            for (const list of lists) disposeList(list);
            return;
        }
        this.provideRequest = null;
        provideDebounce.update(this.key, sw.elapsed());
        const candidates = answers.flatMap((list, rank) =>
            (list?.lenses ?? []).map((lens) => ({ lens, rank, provider: providers[rank] })),
        );
        this.replaceItems(candidates, lists);
        if (this.hasWaitingInView()) this.scheduleResolve();
    }

    /** Within a line as upstream `getCodeLensModel`: provider rank, column. A range past the document is clamped into it. */
    private replaceItems(
        candidates: readonly { readonly lens: CodeLens; readonly rank: number; readonly provider: CodeLensProvider }[],
        lists: readonly CodeLensList[],
    ): void {
        const sorted = candidates
            .map((candidate) => ({ ...candidate, range: this.clampRange(candidate.lens.range) }))
            .sort((a, b) => a.rank - b.rank || a.range.start.character - b.range.start.character);
        const ids = this.model.document.deltaDecorations(
            this.items.map((item) => item.id),
            sorted.map(({ range }) => ({
                range,
                options: {
                    // Stryker disable next-line StringLiteral: the description only names the decoration in a debugger
                    description: "codeLens",
                    stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
            })),
        );
        this.items = ids.map((id, i) => {
            const { lens, provider, range } = sorted[i];
            const needsResolve = lens.command === undefined && provider.resolveCodeLens !== undefined;
            return {
                id,
                provider,
                lens,
                nonEmptyAtStart: range.start.line !== range.end.line || range.start.character !== range.end.character,
                // Stryker disable next-line StringLiteral: only "waiting" and "failed" are ever compared with
                state: needsResolve ? "waiting" : "settled",
            };
        });
        for (const list of this.lists) disposeList(list);
        this.lists = lists;
        this.publish();
    }

    private clampRange(range: IRange): IRange {
        const document = this.model.document;
        const clampPosition = (position: IRange["start"]): IRange["start"] => {
            const line = Math.max(0, Math.min(position.line, document.lineCount - 1));
            return { line, character: Math.max(0, Math.min(position.character, document.getLineLength(line))) };
        };
        return { start: clampPosition(range.start), end: clampPosition(range.end) };
    }

    /**
     * Upstream `CodeLensWidget.isValid`: the text of the lens is gone, a delete of its line among others. The item
     * stays until the next answer replaces it, with no range it is neither shown, nor resolved, nor picked.
     */
    private dropCollapsed(): void {
        const document = this.model.document;
        const gone = this.items.filter((item) => {
            const range = document.getDecorationRange(item.id);
            return (
                range === null ||
                (item.nonEmptyAtStart &&
                    range.start.line === range.end.line &&
                    range.start.character === range.end.character)
            );
        });
        document.deltaDecorations(
            gone.map((item) => item.id),
            [],
        );
    }

    private waitingInView(): ILensItem[] {
        const { startLine, endLine } = this.viewport.getVisibleLineRange();
        const document = this.model.document;
        return this.items.filter((item) => {
            if (item.state !== "waiting") return false;
            const line = document.getDecorationRange(item.id)?.start.line;
            // The bottom row may be the zone of the line below the last visible one.
            return line !== undefined && line >= startLine && line <= endLine + 1;
        });
    }

    private hasWaitingInView(): boolean {
        return this.waitingInView().length > 0;
    }

    private async resolveVisible(): Promise<void> {
        this.resolveRequest?.cancel();
        const request = new CancellationTokenSource();
        this.resolveRequest = request;
        // Stryker disable next-line BooleanLiteral: the resolution of the timer is not observable in a debounce of hundreds of ms
        const sw = new StopWatch(false);
        await Promise.all(
            this.waitingInView().map(async (item) => {
                let resolved: CodeLens | null | undefined = null;
                try {
                    // Stryker disable next-line OptionalChaining: an item waits only if its provider can resolve; for the type
                    resolved = await item.provider.resolveCodeLens?.(this.model, item.lens, request.token);
                } catch (e) {
                    onUnexpectedError(e);
                }
                if (request.token.isCancellationRequested) return;
                if (resolved === null || resolved === undefined) {
                    item.state = "failed";
                } else {
                    // Stryker disable next-line StringLiteral: only "waiting" and "failed" are ever compared with
                    item.state = "settled";
                    item.lens = { ...item.lens, command: resolved.command ?? item.lens.command };
                }
                // Each as it answers: a slow one holds nobody else's title back.
                this.publish();
            }),
        );
        if (request.token.isCancellationRequested) return;
        this.resolveRequest = null;
        resolveDebounce.update(this.key, sw.elapsed());
    }

    /**
     * The document fires inside the edit, before the view state moves its folds and zones: reading the projection
     * here would cache rows of the old folds and a zone set now would be shifted once more. So once the edit is over,
     * in the same task, before any frame.
     */
    private publishAfterEdit(): void {
        if (this.publishQueued) return;
        this.publishQueued = true;
        queueMicrotask(() => {
            this.publishQueued = false;
            if (!this.isDisposedController) this.publish();
        });
    }

    private publish(): void {
        const document = this.model.document;
        const byLine = new Map<number, ILensItem[]>();
        for (const item of this.items) {
            const line = document.getDecorationRange(item.id)?.start.line;
            if (line === undefined) continue;
            const group = byLine.get(line);
            if (group === undefined) byLine.set(line, [item]);
            else group.push(item);
        }
        const zones = [...byLine.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([line, group]) => this.zoneOf(line, group));
        this.onDidChangeZones(zones);
    }

    private zoneOf(line: number, group: readonly ILensItem[]): ICodeLensZone {
        if (group.every((item) => item.state === "failed")) return { line, text: NO_COMMANDS, actions: [] };
        let text = "";
        const actions: ICodeLensAction[] = [];
        for (const { lens } of group) {
            if (lens.command === undefined) continue;
            const title = titleText(lens.command, this.options.nerdFont);
            // An empty title is nothing to click: no action and no doubled separator.
            if (title === "") continue;
            if (text !== "") text += SEPARATOR;
            // Upstream: a command without an id is a plain label.
            if (lens.command.id !== "") {
                actions.push({ start: text.length, end: text.length + title.length, command: lens.command });
            }
            text += title;
        }
        return { line, text, actions };
    }
}
