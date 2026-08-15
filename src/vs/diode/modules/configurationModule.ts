import { ConfigurationRegistry } from "../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistryDIToken } from "../../platform/configuration/common/configurationRegistryDIToken.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../platform/configuration/common/nullConfigurationService.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../workbench/common/configuration/configurationContributions.ts";

export interface ConfigurationModuleContext {
    configurationService: IConfigurationService;
    /** Реестр схем настроек — тот же, из которого собран defaults-слой сервиса. */
    configurationRegistry: ConfigurationRegistry;
}

/**
 * Биндит `IConfigurationServiceDIToken` на готовый экземпляр сервиса и
 * `ConfigurationRegistryDIToken` на реестр схем настроек. В production-сборке
 * это `loadConfiguration(paths, …, registry)` из `main.ts`, в тестах —
 * `NULL_CONFIGURATION_SERVICE` (см. `configurationModuleDefault`).
 */
export const configurationModule: ContainerModule<ConfigurationModuleContext> = (
    container,
    { configurationService, configurationRegistry },
) => {
    container.bind(IConfigurationServiceDIToken, () => configurationService);
    container.bind(ConfigurationRegistryDIToken, () => configurationRegistry);
};

/**
 * Shortcut для тестов и demo: null-сервис настроек, но реестр — настоящий
 * (из `CONFIGURATION_CONTRIBUTIONS`), чтобы валидация settings.json знала
 * реальные ключи.
 */
export const configurationModuleDefault: ContainerModule = (container) => {
    container.bind(IConfigurationServiceDIToken, () => NULL_CONFIGURATION_SERVICE);
    container.bind(ConfigurationRegistryDIToken, () => new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS));
};
