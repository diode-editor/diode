import { ConfigurationRegistry } from "../vs/platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../vs/platform/configuration/common/inMemoryConfigurationService.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../vs/workbench/common/configuration/configurationContributions.ts";

/** `settings` is the user's settings.json (dotted keys); invalid values fall back to the schema default. */
export function createTestConfigurationService(
    settings: Readonly<Record<string, unknown>> = {},
): InMemoryConfigurationService {
    return new InMemoryConfigurationService(new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS), settings);
}
