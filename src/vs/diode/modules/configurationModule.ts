import { ConfigurationRegistry } from "../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistryDIToken } from "../../platform/configuration/common/configurationRegistryDIToken.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
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
 * `InMemoryConfigurationService` (см. `configurationModuleDefault`).
 */
export const configurationModule: ContainerModule<ConfigurationModuleContext> = (
    container,
    { configurationService, configurationRegistry },
) => {
    container.bind(IConfigurationServiceDIToken, () => configurationService);
    container.bind(ConfigurationRegistryDIToken, () => configurationRegistry);
};

/**
 * Shortcut для тестов и demo: настоящий реестр (из `CONFIGURATION_CONTRIBUTIONS`)
 * и сервис в памяти **с теми же дефолтами** — тесты видят те же значения по
 * умолчанию, что приложение, а запись (выбор темы и т.п.) не трогает диск.
 */
export const configurationModuleDefault: ContainerModule = (container) => {
    const configurationRegistry = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS);
    container.bind(IConfigurationServiceDIToken, () => new InMemoryConfigurationService(configurationRegistry));
    container.bind(ConfigurationRegistryDIToken, () => configurationRegistry);
};
