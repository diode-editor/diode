import { IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import type { IHostVersions } from "../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import { createRegistrySource } from "../../platform/extensionManagement/node/createRegistrySource.ts";
import { createProfileExtensions } from "../../platform/extensionManagement/node/profileExtensions.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { IUserDataProfilesServiceDIToken } from "../../platform/userDataProfile/common/userDataProfile.ts";
import {
    ExtensionPageActions,
    ExtensionPageActionsDIToken,
} from "../../workbench/contrib/extensions/browser/extensionPageActions.ts";
import {
    ExtensionsComponent,
    ExtensionsComponentDIToken,
    ExtensionsEditorTargetDIToken,
} from "../../workbench/contrib/extensions/browser/extensionsComponent.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../../workbench/contrib/extensions/common/extensionsWorkbench.ts";
import { ExtensionsWorkbenchService } from "../../workbench/contrib/extensions/node/extensionsWorkbenchService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { IUserDataProfileServiceDIToken } from "../../workbench/services/userDataProfile/common/userDataProfile.ts";

export interface ExtensionsModuleContext {
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
export const extensionsModule: ContainerModule<ExtensionsModuleContext> = (container, { host, onProblem }) => {
    // Источник реестра (`--registry`) и каталог установки — из окружения
    // процесса; состав — активного профиля окна (его `extensions.json`).
    container.bind(ExtensionsWorkbenchServiceDIToken, () => {
        const { registry, extensionsDir } = container.get(IEnvironmentServiceDIToken);
        const profile = createProfileExtensions({
            extensionsDir,
            profile: container.get(IUserDataProfileServiceDIToken).currentProfile,
            profiles: container.get(IUserDataProfilesServiceDIToken),
            logger: container.get(ILogServiceDIToken).createLogger("extensions", { label: "Extensions" }),
        });
        return new ExtensionsWorkbenchService(createRegistrySource(registry, onProblem), profile, host);
    });
    // Действия страницы: установка/удаление с прогрессом и сообщением, плюс
    // перезагрузка окна командой.
    container.bind(ExtensionPageActionsDIToken, ExtensionPageActions);
    container.bind(ExtensionsComponentDIToken, ExtensionsComponent);
    // Страница расширения — обычная вкладка: открывает её полоса редакторов,
    // `EditorService` соответствует шву структурно.
    container.bind(ExtensionsEditorTargetDIToken, () => container.get(EditorServiceDIToken));
};
