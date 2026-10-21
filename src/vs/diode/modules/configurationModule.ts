import { ConfigurationRegistry } from "../../platform/configuration/common/configurationRegistry.ts";
import { ConfigurationRegistryDIToken } from "../../platform/configuration/common/configurationRegistryDIToken.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../workbench/common/configuration/configurationContributions.ts";

export interface ConfigurationModuleContext {
    configurationService: IConfigurationService;
    /** Settings schema registry — the same one the service's defaults layer is built from. */
    configurationRegistry: ConfigurationRegistry;
}

export const configurationModule: ContainerModule<ConfigurationModuleContext> = (
    container,
    { configurationService, configurationRegistry },
) => {
    container.bind(IConfigurationServiceDIToken, () => configurationService);
    container.bind(ConfigurationRegistryDIToken, () => configurationRegistry);
};

/** Real registry and an in-memory service with the same defaults: tests see app values, and writes never touch disk. */
export const configurationModuleDefault: ContainerModule = (container) => {
    const configurationRegistry = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS);
    container.bind(IConfigurationServiceDIToken, () => new InMemoryConfigurationService(configurationRegistry));
    container.bind(ConfigurationRegistryDIToken, () => configurationRegistry);
};
