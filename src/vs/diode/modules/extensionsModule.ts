import { IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import type { IHostVersions } from "../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import { createRegistrySource } from "../../platform/extensionManagement/node/createRegistrySource.ts";
import { createProfileExtensions } from "../../platform/extensionManagement/node/profileExtensions.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { IUserDataProfilesServiceDIToken } from "../../platform/userDataProfile/common/userDataProfile.ts";
import {
    ExtensionAutoUpdateContribution,
    ExtensionAutoUpdateContributionDIToken,
    WorkbenchExtensionUpdateScheduler,
} from "../../workbench/contrib/extensions/browser/extensionAutoUpdate.ts";
import {
    ExtensionPageActions,
    ExtensionPageActionsDIToken,
} from "../../workbench/contrib/extensions/browser/extensionPageActions.ts";
import {
    ExtensionsComponent,
    ExtensionsComponentDIToken,
    ExtensionsEditorTargetDIToken,
} from "../../workbench/contrib/extensions/browser/extensionsComponent.ts";
import {
    ExtensionUpdateContribution,
    ExtensionUpdateContributionDIToken,
} from "../../workbench/contrib/extensions/browser/extensionUpdateActions.ts";
import {
    ExtensionVersionContribution,
    ExtensionVersionContributionDIToken,
} from "../../workbench/contrib/extensions/browser/extensionVersionActions.ts";
import { ExtensionsWorkbenchServiceDIToken } from "../../workbench/contrib/extensions/common/extensionsWorkbench.ts";
import { ExtensionUpdateSchedulerDIToken } from "../../workbench/contrib/extensions/common/extensionUpdateScheduler.ts";
import { ExtensionsWorkbenchService } from "../../workbench/contrib/extensions/node/extensionsWorkbenchService.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { IUserDataProfileServiceDIToken } from "../../workbench/services/userDataProfile/common/userDataProfile.ts";

export interface ExtensionsModuleContext {
    host: IHostVersions;
    onProblem?: (message: string) => void;
}

export const extensionsModule: ContainerModule<ExtensionsModuleContext> = (container, { host, onProblem }) => {
    container.bind(ExtensionsWorkbenchServiceDIToken, () => {
        const { registry, extensionsDir } = container.get(IEnvironmentServiceDIToken);
        const logger = container.get(ILogServiceDIToken).createLogger("extensions", { label: "Extensions" });
        const profile = createProfileExtensions({
            extensionsDir,
            profile: container.get(IUserDataProfileServiceDIToken).currentProfile,
            profiles: container.get(IUserDataProfilesServiceDIToken),
            logger,
        });
        return new ExtensionsWorkbenchService(createRegistrySource(registry, onProblem), profile, host, logger);
    });
    container.bind(ExtensionPageActionsDIToken, ExtensionPageActions);
    container.bind(ExtensionsComponentDIToken, ExtensionsComponent);
    container.bind(ExtensionVersionContributionDIToken, ExtensionVersionContribution);
    container.bind(ExtensionUpdateContributionDIToken, ExtensionUpdateContribution);
    container.bind(ExtensionUpdateSchedulerDIToken, WorkbenchExtensionUpdateScheduler);
    container.bind(ExtensionAutoUpdateContributionDIToken, ExtensionAutoUpdateContribution);
    container.bind(ExtensionsEditorTargetDIToken, () => container.get(EditorServiceDIToken));
};
