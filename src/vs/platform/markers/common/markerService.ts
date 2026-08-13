import type { IDisposable } from "@tuidom/all/common/disposable";

import type { IMarker, IMarkerData, MarkerSeverity } from "./iMarker.ts";

/** Filter for {@link MarkerService.read}. All fields are optional (AND-combined). */
export interface IMarkerReadFilter {
    readonly owner?: string;
    readonly resource?: string;
    /** Keep only markers whose severity is one of these. */
    readonly severities?: readonly MarkerSeverity[];
}

/**
 * Central, provider-agnostic registry of diagnostics — the Vexx analogue of
 * VS Code's `IMarkerService` (`vs/platform/markers`).
 *
 * Diagnostics are deliberately decoupled from their producers: language
 * servers, problem matchers and extensions (`languages.createDiagnosticCollection`)
 * are just *providers* that call {@link changeOne}; the problems panel, editor
 * squiggles and status-bar counters are *consumers* that {@link read} and
 * subscribe to {@link onDidChangeMarkers}. So a useful subset can ship with a
 * single built-in provider and no LSP.
 *
 * Storage is keyed `owner → resource → markers`, mirroring the way VS Code lets
 * each provider replace its own slice of a resource's markers without touching
 * another provider's.
 *
 * `resource` — это `uri.toString()`, а не путь на диске: диагностики бывают и у
 * ресурсов вне диска (безымянный буфер, git-версия), а по пути их не адресовать.
 * Ключ строковый, потому что `Map` не сравнивает `Uri` по значению — вопрос лишь в
 * том, какая это строка; канонизацию даёт сам `Uri.toString()`.
 */
export class MarkerService {
    private byOwner = new Map<string, Map<string, IMarker[]>>();
    private listeners: ((resources: readonly string[]) => void)[] = [];

    /**
     * Replaces all markers owned by `owner` for `resource`. Passing an empty
     * array clears them. Fires {@link onDidChangeMarkers} with `[resource]`.
     */
    public changeOne(owner: string, resource: string, markers: readonly IMarkerData[]): void {
        let byResource = this.byOwner.get(owner);

        if (markers.length === 0) {
            if (byResource?.has(resource) !== true) return;
            byResource.delete(resource);
            if (byResource.size === 0) this.byOwner.delete(owner);
            this.fireChange([resource]);
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
        this.fireChange([resource]);
    }

    /** Reads markers matching `filter` across all owners/resources. */
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

    public onDidChangeMarkers(listener: (resources: readonly string[]) => void): IDisposable {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const i = this.listeners.indexOf(listener);
                if (i >= 0) this.listeners.splice(i, 1);
            },
        };
    }

    private fireChange(resources: readonly string[]): void {
        for (const listener of this.listeners) listener(resources);
    }
}
