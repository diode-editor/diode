import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type { Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { StopWatch } from "../../../../base/common/stopwatch.ts";
import { comparePositions, type IPosition, positionsEqual } from "../../../common/core/iPosition.ts";
import type { IRange } from "../../../common/core/iRange.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type { ILink, LinkProvider } from "../../../common/languages/iLinkSource.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import { TrackedRangeStickiness } from "../../../common/model/trackedDecorations.ts";
import { FeatureDebounce } from "../../../common/services/languageFeatureDebounce.ts";

import { getLinks } from "./getLinks.ts";

export interface ILinkDetectorModel extends ILanguageFeatureTarget {
    readonly document: ITextDocument;
    readonly onDidChangeLanguage: Event<unknown>;
}

/** Upstream `languageFeatureDebounceService.for(providers, 'Links', { min: 1000, max: 4000 })`. */
const linkDebounce = new FeatureDebounce(1000, 4000);

interface ILinkOccurrence {
    readonly decorationId: string;
    readonly link: ILink;
}

/**
 * Port of upstream `LinkDetector`, without the mouse: asks the providers on open and on a language, provider or
 * `editor.links` change at once, after an edit with a debounce. Each link is a tracked document decoration: until the
 * next answer its underline follows the text, and a link whose text is gone is dropped.
 */
export class LinkDetector extends Disposable {
    private readonly computeScheduler: RunOnceScheduler;
    private computeRequest: CancellationTokenSource | null = null;
    private occurrences: readonly ILinkOccurrence[] = [];

    public constructor(
        private readonly model: ILinkDetectorModel,
        private readonly registry: LanguageFeatureRegistry<LinkProvider>,
        private enabled: boolean,
        private readonly onDidChangeRanges: (ranges: readonly IRange[]) => void,
    ) {
        super();
        this.computeScheduler = this.register(
            new RunOnceScheduler(() => {
                void this.beginCompute();
            }, linkDebounce.get(model.uri.toString())),
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
        // The document moves the decorations before its events: the underlines follow the text at once.
        this.register(
            model.document.onDidChangeModelContent(() => {
                if (!this.enabled) return;
                if (this.occurrences.length > 0) this.publish();
                this.computeScheduler.schedule(linkDebounce.get(this.model.uri.toString()));
            }),
        );
        this.register({
            dispose: () => {
                this.stop();
                this.updateDecorations([]);
            },
        });
        this.update();
    }

    /** `editor.links`: turning it off removes the underlines at once, turning it on asks again. */
    public setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        this.update();
    }

    /**
     * Upstream `getLinkOccurrence`: the bounds count, so a caret right after a link is on it. Of two adjacent links
     * the one the position is inside wins.
     */
    public getLinkAt(position: IPosition): ILink | null {
        let endingHere: ILink | null = null;
        for (const { decorationId, link } of this.occurrences) {
            const range = this.liveRange(decorationId);
            if (range === null) continue;
            if (comparePositions(range.start, position) > 0) break;
            if (positionsEqual(range.end, position)) endingHere = link;
            else if (comparePositions(position, range.end) < 0) return link;
        }
        return endingHere;
    }

    private update(): void {
        this.stop();
        if (!this.enabled) {
            this.updateDecorations([]);
            return;
        }
        void this.beginCompute();
    }

    private async beginCompute(): Promise<void> {
        this.computeRequest?.cancel();
        const request = new CancellationTokenSource();
        this.computeRequest = request;
        const document = this.model.document;
        const versionId = document.versionId;
        // Stryker disable next-line BooleanLiteral: the resolution of the timer is not observable in a debounce of seconds
        const sw = new StopWatch(false);
        const links = await getLinks(
            this.registry,
            this.model,
            { uri: this.model.uri.toString(), languageId: this.model.languageId, versionId, document },
            request.token,
        );
        // Superseded, stopped, or the text moved under the answer: the edit has scheduled the next request.
        if (request.token.isCancellationRequested || document.versionId !== versionId) return;
        this.computeRequest = null;
        linkDebounce.update(this.model.uri.toString(), sw.elapsed());
        this.updateDecorations(links);
    }

    private stop(): void {
        this.computeScheduler.cancel();
        this.computeRequest?.cancel();
        this.computeRequest = null;
    }

    /** By position: {@link getLinkAt} and the frame walk them in order, whatever order a provider answered in. */
    private updateDecorations(links: readonly ILink[]): void {
        const sorted = [...links].sort((a, b) => comparePositions(a.range.start, b.range.start));
        const ids = this.model.document.deltaDecorations(
            this.occurrences.map((occurrence) => occurrence.decorationId),
            sorted.map((link) => ({
                range: link.range,
                options: {
                    description: "detected-link",
                    stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
            })),
        );
        this.occurrences = ids.map((decorationId, i) => ({ decorationId, link: sorted[i] }));
        this.publish();
    }

    /** `null` — its text is gone. */
    private liveRange(decorationId: string): IRange | null {
        const range = this.model.document.getDecorationRange(decorationId);
        return range === null || positionsEqual(range.start, range.end) ? null : range;
    }

    private publish(): void {
        const ranges: IRange[] = [];
        for (const { decorationId } of this.occurrences) {
            const range = this.liveRange(decorationId);
            if (range !== null) ranges.push(range);
        }
        this.onDidChangeRanges(ranges);
    }
}
