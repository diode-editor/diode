import type { ILanguageConfigurationService } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import { LanguageConfigurationServiceDIToken } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ILanguageService } from "../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenStyleResolverDIToken } from "../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import { TokenizationRegistryDIToken } from "../../editor/common/languages/tokenizationRegistry.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../editor/common/services/languageFeaturesService.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";

export interface TokenizationModuleContext {
    tokenizationRegistry: TokenizationRegistry;
    tokenStyleResolver: ITokenStyleResolver;
    languageService: ILanguageService;
    languageConfigurationService: ILanguageConfigurationService;
}

/**
 * Языки: реестр грамматик, резолвер стилей, language service и конфигурации
 * языков (`language-configuration.json`). Эти реализации передаются снаружи —
 * в production это нагруженный `TokenizationRegistry` + `TokenThemeResolver` +
 * `LanguageConfigurationService`, в тестах — пустые/NULL-стабы.
 *
 * Реестры языковых провайдеров (`ILanguageFeaturesService`) модуль создаёт сам:
 * они стартуют пустыми в любом профиле, наполняют их host и встроенные фичи.
 */
export const tokenizationModule: ContainerModule<TokenizationModuleContext> = (
    container,
    { tokenizationRegistry, tokenStyleResolver, languageService, languageConfigurationService },
) => {
    container.bind(TokenizationRegistryDIToken, () => tokenizationRegistry);
    container.bind(TokenStyleResolverDIToken, () => tokenStyleResolver);
    container.bind(LanguageServiceDIToken, () => languageService);
    container.bind(LanguageConfigurationServiceDIToken, () => languageConfigurationService);
    container.bind(LanguageFeaturesServiceDIToken, () => new LanguageFeaturesService());
};
