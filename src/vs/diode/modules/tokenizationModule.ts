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
}

/**
 * Подсветка синтаксиса: реестр грамматик, резолвер стилей и language service.
 * Все три реализации передаются снаружи — в production это нагруженный
 * `TokenizationRegistry` + `TokenThemeResolver`, в тестах — пустые/NULL-стабы.
 */
export const tokenizationModule: ContainerModule<TokenizationModuleContext> = (
    container,
    { tokenizationRegistry, tokenStyleResolver, languageService },
) => {
    container.bind(TokenizationRegistryDIToken, () => tokenizationRegistry);
    container.bind(TokenStyleResolverDIToken, () => tokenStyleResolver);
    container.bind(LanguageServiceDIToken, () => languageService);
};
