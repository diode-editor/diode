import type { ILanguageConfigurationService } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import { LanguageConfigurationServiceDIToken } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ILanguageService } from "../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";
import {
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../workbench/common/coreTokens.ts";

export interface TokenizationModuleContext {
    tokenizationRegistry: TokenizationRegistry;
    tokenStyleResolver: ITokenStyleResolver;
    languageService: ILanguageService;
    languageConfigurationService: ILanguageConfigurationService;
}

/**
 * Языки: реестр грамматик, резолвер стилей, language service и конфигурации
 * языков (`language-configuration.json`). Все реализации передаются снаружи —
 * в production это нагруженный `TokenizationRegistry` + `TokenThemeResolver` +
 * `LanguageConfigurationService`, в тестах — пустые/NULL-стабы.
 */
export const tokenizationModule: ContainerModule<TokenizationModuleContext> = (
    container,
    { tokenizationRegistry, tokenStyleResolver, languageService, languageConfigurationService },
) => {
    container.bind(TokenizationRegistryDIToken, () => tokenizationRegistry);
    container.bind(TokenStyleResolverDIToken, () => tokenStyleResolver);
    container.bind(LanguageServiceDIToken, () => languageService);
    container.bind(LanguageConfigurationServiceDIToken, () => languageConfigurationService);
};
