import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";

import {
    BUBBLE_BADGE,
    type IDecoration,
    type IDecorationData,
    type IDecorationsProvider,
    type IDecorationsService,
    type IResourceDecorationChangeEvent,
} from "./decorations.ts";
import { ResourceTree } from "./resourceTree.ts";

/** Upstream's `DebounceEmitter` delay. */
export const DECORATION_CHANGE_DEBOUNCE_MS = 100;

/** Upstream `localize('bubbleTitle', …)`. */
const BUBBLE_TOOLTIP = "Contains emphasized items";

/** A fetch in flight: a newer one for the same resource and provider cancels it. */
class DecorationRequest {
    public constructor(
        public readonly source: CancellationTokenSource,
        /** What the resource showed before: an empty answer over nothing changes nothing. */
        public readonly previous: IDecorationData | null | undefined,
    ) {}
}

type DecorationEntry = Map<IDecorationsProvider, DecorationRequest | IDecorationData | null>;

const EVERYTHING: IResourceDecorationChangeEvent = { affectsResource: () => true };

class ResourceDecorationChangeEvent implements IResourceDecorationChangeEvent {
    private readonly changed = new ResourceTree<true>();

    public constructor(uris: readonly Uri[]) {
        for (const uri of uris) this.changed.set(uri, true);
    }

    public affectsResource(uri: Uri): boolean {
        return this.changed.get(uri) !== undefined || !this.changed.descendants(uri).next().done;
    }
}

function isData(value: DecorationRequest | IDecorationData | null | undefined): value is IDecorationData {
    return value !== undefined && value !== null && !(value instanceof DecorationRequest);
}

/** Tree order, as upstream's search tree iterates: segment by segment, a parent before its continuations. */
function compareTreeOrder(a: Uri, b: Uri): number {
    const left = a.path.split("/");
    const right = b.path.split("/");
    // Stryker disable next-line MethodExpression,EqualityOperator: a step past the shorter one compares with undefined — both comparisons are false, the length below decides
    const n = Math.min(left.length, right.length);
    // Stryker disable next-line EqualityOperator: see above — a step past the end decides nothing
    for (let i = 0; i < n; i++) {
        if (left[i] < right[i]) return -1;
        if (left[i] > right[i]) return 1;
    }
    return left.length - right.length;
}

/**
 * Upstream `DecorationsService` (`services/decorations/browser/decorationsService.ts`) without CSS: the cache
 * lives per (whole uri, provider) and is never evicted — only the provider's events drop it.
 */
export class DecorationsService extends Disposable implements IDecorationsService {
    public static dependencies = [] as const;

    private readonly onDidChangeDecorationsEmitter = this.register(new Emitter<IResourceDecorationChangeEvent>());
    public readonly onDidChangeDecorations: Event<IResourceDecorationChangeEvent> =
        this.onDidChangeDecorationsEmitter.event;

    /** The newest registration first, as upstream's `unshift`. */
    private readonly providers: IDecorationsProvider[] = [];
    private readonly data = new ResourceTree<DecorationEntry>();
    private pendingChanges: Uri[] = [];
    private readonly changeScheduler = this.register(
        new RunOnceScheduler(() => {
            const changed = this.pendingChanges;
            this.pendingChanges = [];
            this.onDidChangeDecorationsEmitter.fire(new ResourceDecorationChangeEvent(changed));
        }, DECORATION_CHANGE_DEBOUNCE_MS),
    );

    public registerDecorationsProvider(provider: IDecorationsProvider): IDisposable {
        this.providers.unshift(provider);
        this.onDidChangeDecorationsEmitter.fire(EVERYTHING);

        const removeAll = (): void => {
            const uris: Uri[] = [];
            for (const { uri, value } of this.data.entries()) {
                if (value.delete(provider)) uris.push(uri);
            }
            if (uris.length > 0) this.fireDelayed(uris);
        };

        const listener = provider.onDidChange((uris) => {
            if (uris === undefined) {
                removeAll();
                return;
            }
            // Asked again at once, shown or not: so a collapsed folder learns about a change deep inside.
            for (const uri of uris) this.fetchData(this.ensureEntry(uri), uri, provider);
        });

        return toDisposable(() => {
            this.providers.splice(this.providers.indexOf(provider), 1);
            listener.dispose();
            removeAll();
        });
    }

    public getDecoration(uri: Uri, includeChildren: boolean): IDecoration | undefined {
        const own: IDecorationData[] = [];
        const entry = this.ensureEntry(uri);
        for (const provider of this.providers) {
            const data = entry.get(provider);
            if (data === undefined) {
                this.fetchData(entry, uri, provider);
            } else if (isData(data)) {
                own.push(data);
            }
        }

        let bubbles = false;
        /** The first bubbling color in tree order. */
        let bubbledColor: { readonly uri: Uri; readonly color: string } | undefined;
        if (includeChildren) {
            for (const descendant of this.data.descendants(uri)) {
                for (const data of descendant.value.values()) {
                    if (!isData(data) || data.bubble !== true) continue;
                    bubbles = true;
                    if (
                        data.color !== undefined &&
                        (bubbledColor === undefined || compareTreeOrder(descendant.uri, bubbledColor.uri) < 0)
                    ) {
                        bubbledColor = { uri: descendant.uri, color: data.color };
                    }
                }
            }
        }

        const color = own.find((data) => data.color !== undefined)?.color ?? bubbledColor?.color;
        if (bubbles) return { color, badge: BUBBLE_BADGE, tooltip: BUBBLE_TOOLTIP };
        if (own.length === 0) return undefined;
        const letters = own.flatMap(({ letter }) => (letter === undefined || letter === "" ? [] : [letter]));
        const tooltips = own.flatMap(({ tooltip }) =>
            tooltip === undefined || tooltip.trim() === "" ? [] : [tooltip],
        );
        return {
            color,
            badge: letters.length === 0 ? undefined : letters.join(", "),
            tooltip: [...new Set(tooltips)].join(" • "),
        };
    }

    private ensureEntry(uri: Uri): DecorationEntry {
        let entry = this.data.get(uri);
        if (entry === undefined) {
            entry = new Map();
            this.data.set(uri, entry);
        }
        return entry;
    }

    private fetchData(entry: DecorationEntry, uri: Uri, provider: IDecorationsProvider): void {
        const pending = entry.get(provider);
        if (pending instanceof DecorationRequest) pending.source.cancel();
        const source = new CancellationTokenSource();
        const request = new DecorationRequest(
            source,
            pending instanceof DecorationRequest ? pending.previous : pending,
        );
        entry.set(provider, request);
        provider.provideDecorations(uri, source.token).then(
            (data) => {
                if (entry.get(provider) !== request) return;
                entry.set(provider, data ?? null);
                // No event for an empty answer over nothing: a clean file costs the explorer no redraw.
                if (data !== undefined || isData(request.previous)) this.fireDelayed([uri]);
            },
            () => {
                // Asked again on the next draw; no event, so a provider that keeps failing doesn't loop.
                if (entry.get(provider) === request) entry.delete(provider);
            },
        );
    }

    /** Upstream's `DebounceEmitter` merging the uris. */
    private fireDelayed(uris: readonly Uri[]): void {
        // A loop, not a spread: dropping a big cache would overflow the argument limit.
        for (const uri of uris) this.pendingChanges.push(uri);
        if (!this.changeScheduler.isScheduled()) this.changeScheduler.schedule();
    }
}
