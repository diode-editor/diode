import { FileSystemProviderRegistry } from "../../platform/files/common/fileSystemProviderRegistry.ts";
import { DiskFileSystemProvider } from "../../platform/files/node/diskFileSystemProvider.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { MarkerService } from "../../platform/markers/common/markerService.ts";
import {
    FileSystemProviderRegistryDIToken,
    KeybindingsResourceDIToken,
    MarkerServiceDIToken,
    SettingsResourceDIToken,
} from "../../workbench/common/coreTokens.ts";

export interface MarkersModuleContext {
    /** Absolute path of the active-profile Vexx settings.json, or null when unknown (tests/demo). */
    settingsResource: string | null;
    /** Absolute path of the active-profile Vexx keybindings.json, or null when unknown (tests/demo). */
    keybindingsResource: string | null;
}

/**
 * Диагностики + пути user-config файлов: провайдер-агностичный реестр
 * {@link MarkerService} (один инстанс на контейнер — в него пишут поставщики, из
 * него читают потребители) и пути к активным settings.json / keybindings.json
 * Vexx (`SettingsResourceDIToken` / `KeybindingsResourceDIToken`). По settings-пути
 * валидатор узнаёт «свой» файл настроек (а не любой `settings.json`, например от
 * VS Code); оба пути используют Preferences-экшены (`Workbench/Actions/`) для команд «Open Settings» /
 * «Open Keyboard Shortcuts».
 */
export const markersModule: ContainerModule<MarkersModuleContext> = (
    container,
    { settingsResource, keybindingsResource },
) => {
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
    container.bind(SettingsResourceDIToken, () => settingsResource);
    container.bind(KeybindingsResourceDIToken, () => keybindingsResource);
};
