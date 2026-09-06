import { createRegistrySource } from "../../platform/extensionManagement/node/createRegistrySource.ts";
import type { IHostVersions } from "../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../../workbench/contrib/extensions/common/extensionsWorkbench.ts";
import {
    ExtensionsComponent,
    ExtensionsComponentDIToken,
    ExtensionsEditorTargetDIToken,
} from "../../workbench/contrib/extensions/browser/extensionsComponent.ts";
import { ExtensionsWorkbenchService } from "../../workbench/contrib/extensions/node/extensionsWorkbenchService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";

export interface ExtensionsModuleContext {
    /** `--registry`: каталог или URL реестра; `undefined` — публичный магазин Diode. */
    registry: string | undefined;
    /** `<userData>/extensions` — куда ставятся расширения и откуда читается установленное. */
    extensionsDir: string;
    /** Версии сборки для матчинга `engines` (те же, что у CLI-установки). */
    host: IHostVersions;
    /** Диагностики парсера реестра (битые записи) — в лог канала `extensions`. */
    onProblem?: (message: string) => void;
}

/**
 * Магазин расширений в приложении: сервис каталога (сеть + диск), вьюлет
 * `EXTENSIONS` и шов открытия страницы расширения вкладкой.
 *
 * Источник выбирается тем же `createRegistrySource`, что и у CLI-установки, —
 * `--registry` работает одинаково в обоих режимах, а без него оба идут в
 * публичный реестр.
 */
export const extensionsModule: ContainerModule<ExtensionsModuleContext> = (
    container,
    { registry, extensionsDir, host, onProblem },
) => {
    container.bind(
        ExtensionsWorkbenchServiceDIToken,
        () => new ExtensionsWorkbenchService(createRegistrySource(registry, onProblem), extensionsDir, host),
    );
    container.bind(ExtensionsComponentDIToken, ExtensionsComponent);
    // Страница расширения — обычная вкладка: открывает её полоса редакторов,
    // `EditorService` соответствует шву структурно.
    container.bind(ExtensionsEditorTargetDIToken, () => container.get(EditorServiceDIToken));
};
