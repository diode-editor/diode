import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { MarkerService } from "../../platform/markers/common/markerService.ts";
import { MarkerServiceDIToken } from "../../platform/markers/common/markerService.ts";

/**
 * Диагностики: провайдер-агностичный реестр {@link MarkerService} (один инстанс
 * на контейнер — в него пишут поставщики, из него читают потребители).
 */
export const markersModule: ContainerModule = (container) => {
    container.bind(MarkerServiceDIToken, () => new MarkerService());
};
