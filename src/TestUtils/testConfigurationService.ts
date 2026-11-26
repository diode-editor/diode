import { ConfigurationRegistry } from "../vs/platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../vs/platform/configuration/common/inMemoryConfigurationService.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../vs/workbench/common/configuration/configurationContributions.ts";

/** `settings` is the user's settings.json (dotted keys); invalid values fall back to the schema default. */
export function createTestConfigurationService(
    settings: Readonly<Record<string, unknown>> = {},
): InMemoryConfigurationService {
    return new InMemoryConfigurationService(new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS), settings);
}

/** Ctrl+Shift keys are gated on an extended tier, which only an explicit setting turns on (#1049). */
export const EXTENDED_TIER_SETTINGS: Readonly<Record<string, unknown>> = { "terminal.tier": "csi-u" };
