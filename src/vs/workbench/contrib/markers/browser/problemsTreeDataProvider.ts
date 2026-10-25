import * as path from "node:path";

import type { StyleColor } from "@tuidom/core/dom/styles/tuiStyle";
import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";

import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IMarker } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { type IProductIconService, NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";

/** `path.basename` must not be applied to a uri resource: on `untitled:Untitled-1` it gives a wrong answer. */
function resourceLabel(resource: string): string {
    const uri = Uri.parse(resource);
    return uri.scheme === "file" ? path.basename(uri.fsPath) : uri.path;
}

/** A file node without data (it is looked up by `resource`): on update the tree may return the previous node object. */
export type ProblemNode =
    | { readonly kind: "file"; readonly resource: string }
    | { readonly kind: "marker"; readonly resource: string; readonly marker: IMarker; readonly index: number };

export interface SeverityColors {
    error: StyleColor;
    warning: StyleColor;
    info: StyleColor;
    hint: StyleColor;
}

const SEVERITY_ICON: Record<MarkerSeverity, IProductIcon> = {
    [MarkerSeverity.Error]: codicon("error"),
    [MarkerSeverity.Warning]: codicon("warning"),
    [MarkerSeverity.Info]: codicon("info"),
    [MarkerSeverity.Hint]: codicon("lightbulb"),
};

export class ProblemsTreeDataProvider implements ITreeDataProvider<ProblemNode> {
    public severityColors: SeverityColors = { error: 0, warning: 0, info: 0, hint: 0 };
    public icons: IProductIconService = NERD_FONT_ICONS;
    public onChange?: (element?: ProblemNode) => void;

    private byResource = new Map<string, readonly IMarker[]>();
    private resources: string[] = [];

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
            icon: this.icons.glyph(SEVERITY_ICON[element.marker.severity]),
            iconColor: this.colorFor(element.marker.severity),
        };
    }

    public getKey(element: ProblemNode): string {
        // The prefix is the node kind, not a scheme: `resource` is already a uri (`file:///a.json`),
        // and a `file:` prefix on top of it would read as a doubled scheme.
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

function compareMarkers(a: IMarker, b: IMarker): number {
    if (a.severity !== b.severity) return b.severity - a.severity;
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    return a.range.start.character - b.range.start.character;
}
