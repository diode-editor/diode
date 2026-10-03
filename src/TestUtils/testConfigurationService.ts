import { ConfigurationRegistry } from "../vs/platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../vs/platform/configuration/common/inMemoryConfigurationService.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../vs/workbench/common/configuration/configurationContributions.ts";

/**
 * Сервис настроек для юнитов — с дефолтами приложения (тот же реестр
 * `CONFIGURATION_CONTRIBUTIONS`, что у тестового профиля и у `main.ts`).
 * `settings` — содержимое settings.json пользователя (точечные ключи);
 * ключ, которого там нет, отвечает дефолтом схемы, мусор — тоже дефолтом.
 */
export function createTestConfigurationService(
    settings: Readonly<Record<string, unknown>> = {},
): InMemoryConfigurationService {
    return new InMemoryConfigurationService(new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS), settings);
}
