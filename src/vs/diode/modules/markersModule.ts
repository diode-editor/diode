import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { MarkerService } from "../../platform/markers/common/markerService.ts";
import { MarkerServiceDIToken } from "../../platform/markers/common/markerService.ts";

export const markersModule: ContainerModule = (container) => {
    container.bind(MarkerServiceDIToken, () => new MarkerService());
};
