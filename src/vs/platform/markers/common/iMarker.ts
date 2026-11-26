import type { IRange } from "../../../editor/common/core/iRange.ts";

/** Values match VS Code `MarkerSeverity`: higher severity is a larger number. */
export enum MarkerSeverity {
    Hint = 1,
    Info = 2,
    Warning = 4,
    Error = 8,
}

/** Like VS Code `IMarkerData`: `owner`/`resource` are passed to `changeOne`, not stored in the record. */
export interface IMarkerData {
    readonly severity: MarkerSeverity;
    readonly range: IRange;
    readonly message: string;
    readonly code?: string;
    readonly source?: string;
}

/** Upstream marker hover: `source(code)`, or whichever of the two is there. */
export function markerOriginLabel({ source, code }: IMarkerData): string {
    if (source !== undefined && code !== undefined) return `${source}(${code})`;
    return source ?? code ?? "";
}

export interface IMarker extends IMarkerData {
    readonly owner: string;
    /** The resource as `uri.toString()`, not a disk path (can be `untitled:`, `git:`, …). */
    readonly resource: string;
}

export interface IMarkerDecoration {
    readonly range: IRange;
    readonly severity: MarkerSeverity;
}
