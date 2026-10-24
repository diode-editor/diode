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
    return [
        marker.source ?? "",
        marker.code ?? "",
        String(marker.severity),
        String(start.line),
        String(start.character),
        String(end.line),
        String(end.character),
    ].join("¦");
}

function mergeApplyTo(current: ApplyToKind, value: ApplyToKind): ApplyToKind {
    return current === value ? current : "allDocuments";
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
    private buffer: string[] = [];
    private bufferLength = 1;
    private matches = 0;
    private maxSeverity: MarkerSeverity | undefined;
    private tail: Promise<void> = Promise.resolve();
    /** By owner: the merged `applyTo` of its matchers and the resources to clean. */
    private readonly owners = new Map<string, { applyTo: ApplyToKind; readonly toClean: Set<string> }>();
    /** owner → resource → marker key → marker. */
    private readonly markers = new Map<string, Map<string, Map<string, IMarkerData>>>();
    /** owner → resource → number of markers delivered. */
    private readonly deliveredMarkers = new Map<string, Map<string, number>>();
    private currentOwner: string | undefined;
    private currentResource: string | undefined;

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
        this.owners.get(owner)?.toClean.delete(resource);
        if (!this.shouldApplyMatch(markerMatch.description.applyTo, resource)) return;
        this.recordMarker(markerMatch.marker, owner, resource);
        if (this.currentOwner !== owner || this.currentResource !== resource) {
            if (this.currentOwner !== undefined && this.currentResource !== undefined) {
                this.deliverMarkers(this.currentOwner, this.currentResource);
            }
            this.currentOwner = owner;
            this.currentResource = resource;
        }
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
        if (this.buffer.length < this.bufferLength) this.buffer.push(line);
        else this.buffer = [...this.buffer.slice(1), line];
        const result = this.tryMatchers();
        if (result !== null) this.buffer = [];
        return result;
    }

    /** The longest pattern that fits the buffered lines first. */
    private tryMatchers(): IProblemMatch | null {
        this.activeMatcher = null;
        const length = this.buffer.length;
        for (let startIndex = 0; startIndex < length; startIndex++) {
            for (const matcher of this.matchers.get(length - startIndex) ?? []) {
                const result = matcher.handle(this.buffer, startIndex);
                if (result.match !== null) {
                    this.captureMatch(result.match);
                    if (result.continue) this.activeMatcher = matcher;
                    return result.match;
                }
            }
        }
        return null;
    }

    private captureMatch(match: IProblemMatch): void {
        this.matches++;
        if (this.maxSeverity === undefined || match.marker.severity > this.maxSeverity) {
            this.maxSeverity = match.marker.severity;
        }
    }

    private shouldApplyMatch(applyTo: ApplyToKind, resource: string): boolean {
        if (applyTo === "openDocuments") return this.host.isOpen(resource);
        if (applyTo === "closedDocuments") return !this.host.isOpen(resource);
        return true;
    }

    private recordMarker(marker: IMarkerData, owner: string, resource: string): void {
        let byResource = this.markers.get(owner);
        if (byResource === undefined) {
            byResource = new Map();
            this.markers.set(owner, byResource);
        }
        let byKey = byResource.get(resource);
        if (byKey === undefined) {
            byKey = new Map();
            byResource.set(resource, byKey);
        }
        const key = markerKey(marker);
        if (!byKey.has(key)) byKey.set(key, marker);
    }

    private reportMarkers(): void {
        for (const [owner, byResource] of this.markers) {
            for (const resource of byResource.keys()) this.deliverMarkers(owner, resource);
        }
    }

    /** Only when the set grew since the last delivery. */
    private deliverMarkers(owner: string, resource: string): void {
        const markers = this.markers.get(owner)?.get(resource);
        if (markers === undefined) return;
        let delivered = this.deliveredMarkers.get(owner);
        if (delivered === undefined) {
            delivered = new Map();
            this.deliveredMarkers.set(owner, delivered);
        }
        if (markers.size === delivered.get(resource)) return;
        this.host.markers.changeOne(owner, resource, [...markers.values()]);
        delivered.set(resource, markers.size);
    }

    private cleanAllMarkers(): void {
        for (const [owner, { applyTo, toClean }] of this.owners) {
            for (const resource of toClean) {
                if (this.shouldApplyMatch(applyTo, resource)) this.host.markers.changeOne(owner, resource, []);
            }
            toClean.clear();
        }
    }
}
