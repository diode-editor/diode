import type { IRange } from "../../../editor/common/core/iRange.ts";

/** Значения — как `MarkerSeverity` VS Code: старшая серьёзность — большее число. */
export enum MarkerSeverity {
    Hint = 1,
    Info = 2,
    Warning = 4,
    Error = 8,
}

/** Как `IMarkerData` VS Code: `owner`/`resource` передаются в `changeOne`, а не лежат в записи. */
export interface IMarkerData {
    readonly severity: MarkerSeverity;
    readonly range: IRange;
    readonly message: string;
    readonly code?: string;
    readonly source?: string;
}

export interface IMarker extends IMarkerData {
    readonly owner: string;
    /** Ресурс как `uri.toString()` — не путь на диске (бывает `untitled:`, `git:`, …). */
    readonly resource: string;
}

export interface IMarkerDecoration {
    readonly range: IRange;
    readonly severity: MarkerSeverity;
}
