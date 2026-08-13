import * as path from "node:path";

import type { StyleColor } from "@tuidom/all/dom/styles/tuiStyle";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/all/ui/tree/iTreeDataProvider";
import { Uri } from "../../../../base/common/uri.ts";
import type { IMarker } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";

/**
 * Короткая метка ресурса для узла-файла. Ресурс маркера — `uri.toString()`, поэтому
 * `path.basename` по нему брать нельзя: на `file:///a/b.ts` он сработал бы случайно,
 * а на `untitled:Untitled-1` дал бы неверный ответ.
 */
function resourceLabel(resource: string): string {
    const uri = Uri.parse(resource);
    return uri.scheme === "file" ? path.basename(uri.fsPath) : uri.path;
}

/**
 * A node in the Problems tree: a lightweight file grouping (data looked up by
 * `resource`, not embedded), or one of its diagnostic markers. Keeping file nodes
 * data-free means a stale node reference (same key) still resolves current markers
 * — the tree may hand back a previous node object on refresh.
 */
export type ProblemNode =
    | { readonly kind: "file"; readonly resource: string }
    | { readonly kind: "marker"; readonly resource: string; readonly marker: IMarker; readonly index: number };

/** Foreground colour per severity, pushed by the controller from the theme. */
export interface SeverityColors {
    error: StyleColor;
    warning: StyleColor;
    info: StyleColor;
    hint: StyleColor;
}

/** Codicon glyphs (PUA — need a nerd-font, as elsewhere in the project). */
const SEVERITY_GLYPH: Record<MarkerSeverity, string> = {
    [MarkerSeverity.Error]: "", // error
    [MarkerSeverity.Warning]: "", // warning
    [MarkerSeverity.Info]: "", // info
    [MarkerSeverity.Hint]: "", // lightbulb
};

/**
 * Tree data for the Problems view: top-level **file** nodes grouping the markers
 * for one resource, each expanding into **marker** leaves. Provider-agnostic — it
 * only reads a marker snapshot handed to it via {@link setMarkers}; the controller
 * refreshes it on `MarkerService.onDidChangeMarkers`.
 */
export class ProblemsTreeDataProvider implements ITreeDataProvider<ProblemNode> {
    /** Severity foregrounds (`editorError/Warning/Info/Hint.foreground`), set by the controller. */
    public severityColors: SeverityColors = { error: 0, warning: 0, info: 0, hint: 0 };
    public onChange?: (element?: ProblemNode) => void;

    private byResource = new Map<string, readonly IMarker[]>();
    private resources: string[] = [];

    /** Replaces the tree contents from a flat marker snapshot: group by file, sort. */
    public setMarkers(markers: readonly IMarker[]): void {
        const byResource = new Map<string, IMarker[]>();
        for (const marker of markers) {
            const bucket = byResource.get(marker.resource);
            if (bucket === undefined) byResource.set(marker.resource, [marker]);
            else bucket.push(marker);
        }
        for (const bucket of byResource.values()) bucket.sort(compareMarkers);
        this.byResource = byResource;
        // Resources are unique Map keys, so two are never equal.
        this.resources = [...byResource.keys()].sort((a, b) => (a < b ? -1 : 1));
    }

    public getChildren(element?: ProblemNode): ProblemNode[] {
        if (element === undefined) return this.resources.map((resource) => ({ kind: "file", resource }));
        if (element.kind === "file") {
            const markers = this.byResource.get(element.resource) ?? [];
            return markers.map((marker, index) => ({ kind: "marker", resource: element.resource, marker, index }));
        }
        return [];
    }

    public getTreeItem(element: ProblemNode): ITreeItem {
        if (element.kind === "file") {
            const count = this.byResource.get(element.resource)?.length ?? 0;
            return {
                label: `${resourceLabel(element.resource)}  (${count})`,
                collapsible: true,
            };
        }
        const start = element.marker.range.start;
        return {
            label: `${element.marker.message}  [Ln ${start.line + 1}, Col ${start.character + 1}]`,
            collapsible: false,
            icon: SEVERITY_GLYPH[element.marker.severity],
            iconColor: this.colorFor(element.marker.severity),
        };
    }

    public getKey(element: ProblemNode): string {
        // Префикс — вид узла, а не схема: `resource` сам уже uri (`file:///a.json`),
        // и `file:`-префикс поверх него читался бы как удвоенная схема.
        return element.kind === "file" ? `node:${element.resource}` : `marker:${element.resource}:${element.index}`;
    }

    private colorFor(severity: MarkerSeverity): StyleColor {
        switch (severity) {
            case MarkerSeverity.Error:
                return this.severityColors.error;
            case MarkerSeverity.Warning:
                return this.severityColors.warning;
            case MarkerSeverity.Info:
                return this.severityColors.info;
            case MarkerSeverity.Hint:
                return this.severityColors.hint;
        }
    }
}

/** Sort markers within a file: highest severity first, then by line, then column. */
function compareMarkers(a: IMarker, b: IMarker): number {
    if (a.severity !== b.severity) return b.severity - a.severity;
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    return a.range.start.character - b.range.start.character;
}
