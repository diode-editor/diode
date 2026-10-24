// Upstream's `problemCollectors.ts`: `AbstractProblemCollector` + `StartStopProblemCollector` with the
// `Clean` strategy, for tasks that are not background ones.

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import type { IMarkerData, MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";

import {
    type ApplyToKind,
    createLineMatcher,
    type ILineMatcher,
    type IProblemMatch,
    type IProblemMatcher,
    type IProblemMatcherFiles,
} from "./problemMatcher.ts";

export interface IProblemCollectorHost {
    readonly markers: MarkerService;
    /** A text model of the resource (`uri.toString()`) is open: `applyTo`. */
    isOpen(resource: string): boolean;
    readonly files: IProblemMatcherFiles;
}

/** Upstream's `IMarkerData.makeKeyOptionalMessage(marker, false)`: the message is not part of the key. */
function markerKey(marker: IMarkerData): string {
    const { start, end } = marker.range;
    return JSON.stringify([
        marker.source,
        marker.code,
        marker.severity,
        start.line,
        start.character,
        end.line,
        end.character,
    ]);
}

function mergeApplyTo(current: ApplyToKind, value: ApplyToKind): ApplyToKind {
    // Stryker disable next-line StringLiteral: equivalent: an unknown applyTo applies to all documents too
    return current === value ? current : "allDocuments";
}

/** The markers found for one resource of one owner, and how many of them the marker service has. */
interface IResourceMarkers {
    readonly owner: string;
    readonly resource: string;
    /** By {@link markerKey}. */
    readonly markers: Map<string, IMarkerData>;
    delivered: number;
}

/**
 * On start remembers the resources the owners already have markers on. A resource the output mentions again
 * gets the new set; one it doesn't is cleared by {@link done}. Markers of a resource are delivered once the
 * output moves to another resource, the rest by {@link done}.
 */
export class StartStopProblemCollector {
    /** By pattern line count. */
    private readonly matchers = new Map<number, ILineMatcher[]>();
    private activeMatcher: ILineMatcher | null = null;
    private buffer: readonly string[] = [];
    private bufferLength = 1;
    private matches = 0;
    private maxSeverity: MarkerSeverity | undefined;
    private tail: Promise<void> = Promise.resolve();
    /** By owner: the merged `applyTo` of its matchers and the resources to clean. */
    private readonly owners = new Map<string, { applyTo: ApplyToKind; readonly toClean: Set<string> }>();
    /** By `[owner, resource]`. */
    private readonly found = new Map<string, IResourceMarkers>();
    /** Where the output is now: its markers are delivered once it moves on. */
    private current: IResourceMarkers | undefined;

    public constructor(
        problemMatchers: readonly IProblemMatcher[],
        private readonly host: IProblemCollectorHost,
    ) {
        for (const problemMatcher of problemMatchers) {
            const matcher = createLineMatcher(problemMatcher, host.files);
            this.bufferLength = Math.max(this.bufferLength, matcher.matchLength);
            const sameLength = this.matchers.get(matcher.matchLength) ?? [];
            sameLength.push(matcher);
            this.matchers.set(matcher.matchLength, sameLength);
            const owner = this.owners.get(problemMatcher.owner);
            if (owner !== undefined) {
                owner.applyTo = mergeApplyTo(owner.applyTo, problemMatcher.applyTo);
                continue;
            }
            // Stryker disable next-line ObjectLiteral: equivalent: clearing another owner's resource for this owner changes nothing
            const toClean = new Set(host.markers.read({ owner: problemMatcher.owner }).map((m) => m.resource));
            this.owners.set(problemMatcher.owner, { applyTo: problemMatcher.applyTo, toClean });
        }
    }

    public get numberOfMatches(): number {
        return this.matches;
    }

    public get maxMarkerSeverity(): MarkerSeverity | undefined {
        return this.maxSeverity;
    }

    /** Lines are processed in order: resolving a file name may wait for the file system. */
    public processLine(line: string): void {
        this.tail = this.tail.then(() => this.processLineInternal(line)).catch(onUnexpectedError);
    }

    /** After the last line: delivers what is left and clears resources the output didn't mention. */
    public async done(): Promise<void> {
        await this.tail;
        this.reportMarkers();
        this.cleanAllMarkers();
    }

    private async processLineInternal(line: string): Promise<void> {
        const markerMatch = this.tryFindMarker(line);
        if (markerMatch === null) return;
        const owner = markerMatch.description.owner;
        const resource = (await markerMatch.resource).toString();
        // Stryker disable next-line OptionalChaining: equivalent: every matcher's owner is in the map
        this.owners.get(owner)?.toClean.delete(resource);
        if (!this.shouldApplyMatch(markerMatch.description.applyTo, resource)) return;
        const found = this.recordMarker(markerMatch.marker, owner, resource);
        if (this.current === found) return;
        if (this.current !== undefined) this.deliver(this.current);
        this.current = found;
    }

    private tryFindMarker(line: string): IProblemMatch | null {
        if (this.activeMatcher !== null) {
            const result = this.activeMatcher.next(line);
            if (result !== null) {
                this.captureMatch(result);
                return result;
            }
            this.buffer = [];
            this.activeMatcher = null;
        }
        this.buffer = [...this.buffer, line].slice(-this.bufferLength);
        const result = this.tryMatchers();
        if (result !== null) this.buffer = [];
        return result;
    }

    /** The longest pattern that fits the buffered lines first. */
    private tryMatchers(): IProblemMatch | null {
        this.activeMatcher = null;
        const length = this.buffer.length;
        // Stryker disable next-line EqualityOperator: equivalent: there are no matchers of zero lines
        for (let startIndex = 0; startIndex < length; startIndex++) {
            for (const matcher of this.matchers.get(length - startIndex) ?? []) {
                const result = matcher.handle(this.buffer, startIndex);
                if (result.match !== null) {
                    this.captureMatch(result.match);
                    // Stryker disable next-line ConditionalExpression: equivalent: a single-line matcher never continues, and dropping it resets nothing a match did not
                    if (result.continue) this.activeMatcher = matcher;
                    return result.match;
                }
            }
        }
        return null;
    }

    private captureMatch(match: IProblemMatch): void {
        this.matches++;
        this.maxSeverity = Math.max(this.maxSeverity ?? 0, match.marker.severity);
    }

    private shouldApplyMatch(applyTo: ApplyToKind, resource: string): boolean {
        if (applyTo === "openDocuments") return this.host.isOpen(resource);
        if (applyTo === "closedDocuments") return !this.host.isOpen(resource);
        return true;
    }

    /** The first of equal problems (the message aside) stays. */
    private recordMarker(marker: IMarkerData, owner: string, resource: string): IResourceMarkers {
        const id = JSON.stringify([owner, resource]);
        let found = this.found.get(id);
        if (found === undefined) {
            found = { owner, resource, markers: new Map(), delivered: 0 };
            this.found.set(id, found);
        }
        const key = markerKey(marker);
        if (!found.markers.has(key)) found.markers.set(key, marker);
        return found;
    }

    private reportMarkers(): void {
        for (const found of this.found.values()) this.deliver(found);
    }

    /** Only when the set grew since the last delivery. */
    private deliver(found: IResourceMarkers): void {
        if (found.markers.size === found.delivered) return;
        this.host.markers.changeOne(found.owner, found.resource, [...found.markers.values()]);
        found.delivered = found.markers.size;
    }

    private cleanAllMarkers(): void {
        for (const [owner, { applyTo, toClean }] of this.owners) {
            for (const resource of toClean) {
                if (this.shouldApplyMatch(applyTo, resource)) this.host.markers.changeOne(owner, resource, []);
            }
        }
    }
}
