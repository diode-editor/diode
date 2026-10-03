import { FileSystemProviderRegistry } from "../../platform/files/common/fileSystemProviderRegistry.ts";
import { FileSystemProviderRegistryDIToken } from "../../platform/files/common/iFileSystemProviderRegistry.ts";
import { DiskFileSystemProvider } from "../../platform/files/node/diskFileSystemProvider.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { MarkerService } from "../../platform/markers/common/markerService.ts";
import { MarkerServiceDIToken } from "../../platform/markers/common/markerService.ts";

/**
 * Диагностики и реестр поставщиков содержимого: провайдер-агностичный реестр
 * {@link MarkerService} (один инстанс на контейнер — в него пишут поставщики, из
 * него читают потребители) и {@link FileSystemProviderRegistry} по схемам URI.
 */
export const markersModule: ContainerModule = (container) => {
    container.bind(MarkerServiceDIToken, () => new MarkerService());
    // Реестр поставщиков содержимого по схеме: из коробки — только read-only
    // `file:` с диска (browser-потребители без открытого редактора, например
    // прямой дифф из Changes); схемы расширений (`git:`) регистрирует адаптер
    // extension host'а после активации.
    container.bind(FileSystemProviderRegistryDIToken, () => {
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("file", new DiskFileSystemProvider());
        return registry;
    });
};
