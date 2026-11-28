import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { Event } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Upstream `IDecorationData`, narrowed to what a file decoration provider can say (no weight, no strikethrough). */
export interface IDecorationData {
    /** A theme color id: it resolves when drawn, so a theme change repaints without asking the provider again. */
    readonly color?: string;
    readonly letter?: string;
    readonly tooltip?: string;
    /** Shows on the ancestor folders too. */
    readonly bubble?: boolean;
}

/** Upstream `IDecoration` without CSS: what a row draws. */
export interface IDecoration {
    readonly color?: string;
    /** The providers' letters joined by `", "`, or {@link BUBBLE_BADGE} for a folder with bubbled descendants. */
    readonly badge?: string;
    readonly tooltip: string;
}

export interface IDecorationsProvider {
    readonly label: string;
    /** `undefined`: everything may have changed. */
    readonly onDidChange: Event<readonly Uri[] | undefined>;
    provideDecorations(uri: Uri, token: ICancellationToken): Promise<IDecorationData | undefined>;
}

export interface IResourceDecorationChangeEvent {
    /** Also true for an ancestor of a changed resource. */
    affectsResource(uri: Uri): boolean;
}

/** Upstream `IDecorationsService`. */
export interface IDecorationsService {
    readonly onDidChangeDecorations: Event<IResourceDecorationChangeEvent>;
    registerDecorationsProvider(provider: IDecorationsProvider): IDisposable;
    /**
     * What is known now; a resource not asked about yet is requested from the providers, and its answer
     * arrives as a change event. `includeChildren` adds the bubbling data of descendants already resolved.
     */
    getDecoration(uri: Uri, includeChildren: boolean): IDecoration | undefined;
}

export const DecorationsServiceDIToken = token<IDecorationsService>("DecorationsService");

/** Badge of a folder that contains bubbled decorations (upstream's `circle-filled` codicon). */
export const BUBBLE_BADGE = "●";

/** No providers: nothing is decorated. */
export const NULL_DECORATIONS_SERVICE: IDecorationsService = {
    onDidChangeDecorations: () => Disposable.None,
    registerDecorationsProvider: () => Disposable.None,
    getDecoration: () => undefined,
};
