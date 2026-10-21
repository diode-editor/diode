import { Emitter } from "../../../base/common/event.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { IMarker, IMarkerData, MarkerSeverity } from "./iMarker.ts";

/** Fields combine with AND. */
export interface IMarkerReadFilter {
    readonly owner?: string;
    readonly resource?: string;
    readonly severities?: readonly MarkerSeverity[];
}

/**
 * Stored as `owner → resource → markers`: each provider replaces its own slice of a resource without
 * touching others. `resource` is `uri.toString()`, not a path: diagnostics exist for off-disk resources
 * (an untitled buffer, a git revision), and `Map` doesn't compare `Uri` by value.
 */
export class MarkerService {
    private byOwner = new Map<string, Map<string, IMarker[]>>();
    private readonly onDidChangeMarkersEmitter = new Emitter<readonly string[]>();
    public readonly onDidChangeMarkers = this.onDidChangeMarkersEmitter.event;

    /** An empty array clears the slice. */
    public changeOne(owner: string, resource: string, markers: readonly IMarkerData[]): void {
        let byResource = this.byOwner.get(owner);

        if (markers.length === 0) {
            if (byResource?.has(resource) !== true) return;
            byResource.delete(resource);
            if (byResource.size === 0) this.byOwner.delete(owner);
            this.onDidChangeMarkersEmitter.fire([resource]);
            return;
        }

        if (byResource === undefined) {
            byResource = new Map<string, IMarker[]>();
            this.byOwner.set(owner, byResource);
        }
        byResource.set(
            resource,
            markers.map((data) => ({ ...data, owner, resource })),
        );
        this.onDidChangeMarkersEmitter.fire([resource]);
    }

    public read(filter: IMarkerReadFilter = {}): IMarker[] {
        const result: IMarker[] = [];
        for (const [owner, byResource] of this.byOwner) {
            if (filter.owner !== undefined && filter.owner !== owner) continue;
            for (const [resource, markers] of byResource) {
                if (filter.resource !== undefined && filter.resource !== resource) continue;
                for (const marker of markers) {
                    if (filter.severities !== undefined && !filter.severities.includes(marker.severity)) continue;
                    result.push(marker);
                }
            }
        }
        return result;
    }
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it, the string inside is just a debug label
export const MarkerServiceDIToken = token<MarkerService>("MarkerService");
