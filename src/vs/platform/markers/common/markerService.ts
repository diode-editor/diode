import { Emitter } from "../../../base/common/event.ts";
import { token } from "../../instantiation/common/diContainer.ts";

import type { IMarker, IMarkerData, MarkerSeverity } from "./iMarker.ts";

/** Поля комбинируются по AND. */
export interface IMarkerReadFilter {
    readonly owner?: string;
    readonly resource?: string;
    readonly severities?: readonly MarkerSeverity[];
}

/**
 * Хранение `owner → resource → markers`: каждый провайдер заменяет свой срез ресурса, не трогая
 * чужой. `resource` — `uri.toString()`, а не путь: диагностики бывают у ресурсов вне диска
 * (безымянный буфер, git-версия), а `Map` не сравнивает `Uri` по значению.
 */
export class MarkerService {
    private byOwner = new Map<string, Map<string, IMarker[]>>();
    private readonly onDidChangeMarkersEmitter = new Emitter<readonly string[]>();
    public readonly onDidChangeMarkers = this.onDidChangeMarkersEmitter.event;

    /** Пустой массив очищает срез. */
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

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const MarkerServiceDIToken = token<MarkerService>("MarkerService");
