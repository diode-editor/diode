import type { Event } from "../../../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { type IMarker, MarkerSeverity } from "../../../../../platform/markers/common/iMarker.ts";
import type { IMarkerReadFilter } from "../../../../../platform/markers/common/markerService.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { DiagnosticsSink } from "../../../../api/common/iExtensionWindowSinks.ts";
import type { IWireForeignMarkers, WireMarker } from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireDiagnosticsPublish } from "../hostWireParsers.ts";

export interface IMarkerReader {
    readonly onDidChangeMarkers: Event<readonly string[]>;
    read(filter?: IMarkerReadFilter): IMarker[];
}

/** → `vscode.DiagnosticSeverity` (0=Error…3=Hint). */
function toWireSeverity(severity: MarkerSeverity): number {
    switch (severity) {
        case MarkerSeverity.Warning:
            return 1;
        case MarkerSeverity.Info:
            return 2;
        case MarkerSeverity.Hint:
            return 3;
        default:
            return 0;
    }
}

function toWireMarker(marker: IMarker): WireMarker {
    return {
        severity: toWireSeverity(marker.severity),
        range: marker.range,
        message: marker.message,
        ...(marker.code !== undefined ? { code: marker.code } : {}),
        ...(marker.source !== undefined ? { source: marker.source } : {}),
    };
}

/**
 * `MainThreadDiagnostics` эталона в обе стороны; обратно уходят маркеры чужих владельцев.
 * «Свой» — владелец, которого хоть раз публиковал субпроцесс (у эталона — `origin` маркера).
 * Множество живёт с хостом: маркеры умершего спавна остаются в MarkerService и не чужие новому.
 */
export class DiagnosticsCustomer implements IExtensionHostCustomer {
    private readonly ownOwners = new Set<string>();
    /**
     * Ресурсы с ушедшими непустыми чужими маркерами — их исчезновение сообщается пустым набором.
     * Отклонение: эталон шлёт пустой набор, лишь когда маркеров не осталось вовсе, и держит снятые чужие.
     */
    private readonly forwarded = new Set<string>();
    private rpc: HostRpc | null = null;

    public constructor(
        private readonly sink: DiagnosticsSink | undefined,
        private readonly markers: IMarkerReader | undefined,
    ) {}

    /** До первой активации: чужие маркеры, что легли до спавна. */
    public pushInitialState(): void {
        if (this.markers === undefined) return;
        this.forward(
            this.markers,
            this.markers.read().map((marker) => marker.resource),
        );
    }

    public attach({ rpc }: IExtensionHostContext): IDisposable {
        this.rpc = rpc;
        const store = new DisposableStore();
        store.add(
            rpc.handleNotification("diagnostics.publish", (params) => {
                const publish = parseWireDiagnosticsPublish(params);
                if (publish === null) return;
                // Владелец — свой ДО записи в MarkerService: её событие
                // вернётся сюда же, и свои маркеры в зеркало не попадут.
                this.ownOwners.add(publish.owner);
                this.sink?.(publish.owner, publish.resource, publish.markers);
            }),
        );
        const markers = this.markers;
        if (markers !== undefined) {
            store.add(
                markers.onDidChangeMarkers((resources) => {
                    this.forward(markers, resources);
                }),
            );
        }
        store.add({
            dispose: () => {
                this.rpc = null;
                // Зеркало умерло с субпроцессом — новый начинает с пустого.
                this.forwarded.clear();
            },
        });
        return store;
    }

    private forward(markers: IMarkerReader, resources: readonly string[]): void {
        if (this.rpc === null) return;
        const entries: IWireForeignMarkers[] = [];
        for (const resource of new Set(resources)) {
            const foreign = markers.read({ resource }).filter((marker) => !this.ownOwners.has(marker.owner));
            if (foreign.length === 0) {
                if (!this.forwarded.delete(resource)) continue;
            } else {
                this.forwarded.add(resource);
            }
            entries.push({ resource, markers: foreign.map(toWireMarker) });
        }
        if (entries.length > 0) this.rpc.notify("diagnostics.markersChanged", { entries });
    }
}
