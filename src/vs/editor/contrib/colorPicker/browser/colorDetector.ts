import { packRgba } from "@tuidom/core/common/colorUtils";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import type { Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import { StopWatch } from "../../../../base/common/stopwatch.ts";
import { positionsEqual } from "../../../common/core/iPosition.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type { DocumentColorProvider, IColor, IColorInformation } from "../../../common/languages/iColorSource.ts";
import type { IInlineInsertion } from "../../../common/model/iInlineInsertion.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import { FeatureDebounce } from "../../../common/services/languageFeatureDebounce.ts";

import { type DefaultColorDecoratorsEnablement, getColors } from "./color.ts";

export interface IColorDetectorModel extends ILanguageFeatureTarget {
    readonly document: ITextDocument;
    readonly onDidChangeLanguage: Event<unknown>;
}

/** `editor.colorDecorators`, `editor.defaultColorDecorators`, `editor.colorDecoratorsLimit`. */
export interface IColorDecoratorsOptions {
    readonly enabled: boolean;
    readonly defaultEnablement: DefaultColorDecoratorsEnablement;
    readonly limit: number;
}

export const DEFAULT_COLOR_DECORATORS_OPTIONS: IColorDecoratorsOptions = {
    enabled: true,
    defaultEnablement: "auto",
    limit: 500,
};

/** The square drawn before a color, and a space: one terminal cell cannot hold upstream's 10px box and its margin. */
export const COLOR_DECORATOR_TEXT = "■ ";

/** Translucent colors stay translucent: the frame blends them over the cell's background, as the browser does. */
function packColor(color: IColor): number {
    return packRgba(
        Math.round(color.red * 255),
        Math.round(color.green * 255),
        Math.round(color.blue * 255),
        Math.round(color.alpha * 255),
    );
}

/**
 * Deviation: upstream waits at least 1000 ms; the spec wants a square within a fraction of a second,
 * and the default detector is a regular expression pass.
 */
const RECOMPUTE_MIN_DELAY = 300;
const RECOMPUTE_MAX_DELAY = 1000;

/** Upstream `languageFeatureDebounceService.for(colorProvider, …)`: shared by every editor, keyed by the document. */
const colorDebounce = new FeatureDebounce(RECOMPUTE_MIN_DELAY, RECOMPUTE_MAX_DELAY);

interface IDecorator {
    readonly id: string;
    readonly fg: number;
}

/**
 * Port of upstream `ColorDetector`: asks the color providers on open, on a language, provider or option
 * change, and after an edit with a debounce. Each square is a `before` insertion at the start of its
 * color, anchored by a tracked document decoration: until the next answer it follows the text, and is
 * dropped as soon as its color text is gone.
 */
export class ColorDetector extends Disposable {
    private readonly localToDispose = this.register(new DisposableStore());
    private readonly computeScheduler: RunOnceScheduler;
    private computeRequest: CancellationTokenSource | null = null;
    private decorators: readonly IDecorator[] = [];

    public constructor(
        private readonly model: IColorDetectorModel,
        private readonly registry: LanguageFeatureRegistry<DocumentColorProvider>,
        private options: IColorDecoratorsOptions,
        private readonly onDidChangeInsertions: (insertions: readonly IInlineInsertion[]) => void,
    ) {
        super();
        this.computeScheduler = this.register(
            new RunOnceScheduler(() => {
                void this.beginCompute();
            }, RECOMPUTE_MIN_DELAY),
        );
        this.register(
            model.onDidChangeLanguage(() => {
                this.updateColors();
            }),
        );
        this.register(
            registry.onDidChange(() => {
                this.updateColors();
            }),
        );
        // The document moves the decorations before its events: the squares follow the text at once.
        this.register(
            model.document.onDidChangeModelContent(() => {
                // Stryker disable next-line ConditionalExpression,EqualityOperator: publishing no squares again changes nothing on the frame
                if (this.decorators.length > 0) this.publish();
            }),
        );
        this.register({
            dispose: () => {
                this.stop();
                this.removeAllDecorations();
            },
        });
        this.updateColors();
    }

    /** A change of the limit or of the default detector's mode asks again; turning off removes the squares. */
    public setOptions(options: IColorDecoratorsOptions): void {
        const previous = this.options;
        this.options = options;
        if (
            previous.enabled === options.enabled &&
            previous.limit === options.limit &&
            previous.defaultEnablement === options.defaultEnablement
        ) {
            return;
        }
        this.updateColors();
    }

    private updateColors(): void {
        this.stop();
        if (!this.options.enabled) {
            this.removeAllDecorations();
            return;
        }
        if (!this.registry.has(this.model)) return;
        this.localToDispose.add(
            this.model.document.onDidChangeModelContent(() => {
                if (!this.computeScheduler.isScheduled()) {
                    this.computeScheduler.schedule(colorDebounce.get(this.model.uri.toString()));
                }
            }),
        );
        void this.beginCompute();
    }

    private async beginCompute(): Promise<void> {
        this.computeRequest?.cancel();
        const request = new CancellationTokenSource();
        this.computeRequest = request;
        const document = this.model.document;
        const versionId = document.versionId;
        const sw = new StopWatch(false);
        let colors: IColorInformation[];
        try {
            colors = await getColors(
                this.registry,
                this.model,
                { uri: this.model.uri.toString(), languageId: this.model.languageId, versionId, document },
                request.token,
                this.options.defaultEnablement,
            );
        } catch (e) {
            onUnexpectedError(e);
            return;
        }
        // Superseded, stopped, or the text moved under the answer: the edit has scheduled the next request.
        if (request.token.isCancellationRequested || document.versionId !== versionId) return;
        this.computeRequest = null;
        colorDebounce.update(this.model.uri.toString(), sw.elapsed());
        this.updateColorDecorators(colors);
    }

    private stop(): void {
        this.computeScheduler.cancel();
        this.computeRequest?.cancel();
        this.computeRequest = null;
        this.localToDispose.clear();
    }

    /** The first `limit` colors, in the order the providers gave them. */
    private updateColorDecorators(colors: readonly IColorInformation[]): void {
        const limited = colors.slice(0, this.options.limit);
        const ids = this.model.document.deltaDecorations(
            this.decorators.map((decorator) => decorator.id),
            limited.map((color) => ({ range: color.range, options: { description: "colorDetector" } })),
        );
        this.decorators = ids.map((id, i) => ({ id, fg: packColor(limited[i].color) }));
        this.publish();
    }

    private removeAllDecorations(): void {
        if (this.decorators.length === 0) return;
        this.model.document.deltaDecorations(
            this.decorators.map((decorator) => decorator.id),
            [],
        );
        this.decorators = [];
        this.publish();
    }

    private publish(): void {
        const insertions: IInlineInsertion[] = [];
        for (const decorator of this.decorators) {
            const range = this.model.document.getDecorationRange(decorator.id);
            if (range === null || positionsEqual(range.start, range.end)) continue;
            insertions.push({
                line: range.start.line,
                offset: range.start.character,
                text: COLOR_DECORATOR_TEXT,
                fg: decorator.fg,
            });
        }
        this.onDidChangeInsertions(insertions);
    }
}
