import type { Event } from "../../../../../base/common/event.ts";
import { DisposableStore, type IDisposable } from "../../../../../base/common/lifecycle.ts";
import { type IMarker, MarkerSeverity } from "../../../../../platform/markers/common/iMarker.ts";
import type { IMarkerReadFilter } from "../../../../../platform/markers/common/markerService.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import type { DiagnosticsSink } from "../../../../api/common/iExtensionWindowSinks.ts";
import type { IWireForeignMarkers, WireMarker } from "../../../../api/common/wireTypes.ts";
import type { IExtensionHostContext, IExtensionHostCustomer } from "../../common/extensionHostCustomer.ts";
import { parseWireDiagnosticsPublish } from "../hostWireParsers.ts";

/** Чтение MarkerService для обратного пути: какие ресурсы поменялись и что на них лежит. */
export interface IMarkerReader {
    readonly onDidChangeMarkers: Event<readonly string[]>;
    read(filter?: IMarkerReadFilter): IMarker[];
}

/** `MarkerSeverity` → число `vscode.DiagnosticSeverity` (0=Error…3=Hint). */
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
 * Диагностики в обе стороны (`MainThreadDiagnostics` эталона). Туда: коллекции
 * расширений публикуют маркеры (`diagnostics.publish`) — они уходят стоку,
 * module ведёт его в MarkerService (squiggle + Problems). Обратно: маркеры
 * чужих владельцев (настройки, задачи) уходят субпроцессу
 * `diagnostics.markersChanged` — из них `languages.getDiagnostics` и
 * `onDidChangeDiagnostics` видят всё, что видит панель Problems.
 *
 * «Свой» — владелец, которого хоть раз публиковал субпроцесс этого хоста (у
 * эталона — `origin` маркера, id extension host'а): свои маркеры субпроцесс и
 * так держит в коллекциях. Множество живёт с хостом, а не со спавном: маркеры
 * умершего субпроцесса остаются в MarkerService, и новый спавн не должен
 * принять их за чужие.
 */
export class DiagnosticsCustomer implements IExtensionHostCustomer {
    private readonly ownOwners = new Set<string>();
    /**
     * Ресурсы, по которым субпроцессу ушли непустые чужие маркеры. Их
     * исчезновение надо сообщить пустым набором; ресурс, где чужих не было, —
     * молчать (своя публикация не эхом в зеркало). У эталона такого учёта нет:
     * пустой набор он шлёт, только когда у ресурса не осталось маркеров
     * вовсе, — и зеркало держит снятые чужие, пока рядом лежат свои.
     */
    private readonly forwarded = new Set<string>();
    /** Канал текущего спавна; `null` — спавна нет. */
    private rpc: HostRpc | null = null;

    public constructor(
        private readonly sink: DiagnosticsSink | undefined,
        private readonly markers: IMarkerReader | undefined,
    ) {}

    /**
     * Семя — до первой активации: чужие маркеры, что легли до спавна (у
     * эталона их нет — MainThreadDiagnostics поднимается вместе с окном).
     */
    public pushInitialState(): void {
        if (this.markers === undefined) return;
        this.forward(this.markers.read().map((marker) => marker.resource));
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
        if (this.markers !== undefined) {
            store.add(
                this.markers.onDidChangeMarkers((resources) => {
                    this.forward(resources);
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

    private forward(resources: readonly string[]): void {
        if (this.rpc === null || this.markers === undefined) return;
        const entries: IWireForeignMarkers[] = [];
        for (const resource of new Set(resources)) {
            const foreign = this.markers.read({ resource }).filter((marker) => !this.ownOwners.has(marker.owner));
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
