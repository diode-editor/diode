import type { ILanguageConfigurationService } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import { LanguageConfigurationServiceDIToken } from "../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ILanguageService } from "../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../editor/common/languages/iLanguageService.ts";
import {
    type ISemanticTokenStyleResolver,
    NULL_SEMANTIC_TOKEN_STYLE_RESOLVER,
    SemanticTokenStyleResolverDIToken,
} from "../../editor/common/languages/iSemanticTokenStyleResolver.ts";
import type { ITokenStyleResolver } from "../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenStyleResolverDIToken } from "../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import { TokenizationRegistryDIToken } from "../../editor/common/languages/tokenizationRegistry.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../editor/common/services/languageFeaturesService.ts";
import { registerDefaultDocumentColorProvider } from "../../editor/contrib/colorPicker/browser/defaultDocumentColorProvider.ts";
import type { ContainerModule } from "../../platform/instantiation/common/diContainer.ts";

export interface TokenizationModuleContext {
    tokenizationRegistry: TokenizationRegistry;
    tokenStyleResolver: ITokenStyleResolver;
    /** Theme for semantic tokens; without it (tests) — NULL: semantic tokens are not colored. */
    semanticTokenStyleResolver?: ISemanticTokenStyleResolver;
    languageService: ILanguageService;
    languageConfigurationService: ILanguageConfigurationService;
}

/** The module creates the language provider registries itself: in every profile they start with the built-in color detector only. */
export const tokenizationModule: ContainerModule<TokenizationModuleContext> = (
    container,
    {
        tokenizationRegistry,
        tokenStyleResolver,
        semanticTokenStyleResolver = NULL_SEMANTIC_TOKEN_STYLE_RESOLVER,
        languageService,
        languageConfigurationService,
    },
) => {
    container.bind(TokenizationRegistryDIToken, () => tokenizationRegistry);
    container.bind(TokenStyleResolverDIToken, () => tokenStyleResolver);
    container.bind(SemanticTokenStyleResolverDIToken, () => semanticTokenStyleResolver);
    container.bind(LanguageServiceDIToken, () => languageService);
    container.bind(LanguageConfigurationServiceDIToken, () => languageConfigurationService);
    container.bind(LanguageFeaturesServiceDIToken, () => {
        const languageFeatures = new LanguageFeaturesService();
        // Lives as long as the registry: never unregistered.
        registerDefaultDocumentColorProvider(languageFeatures);
        return languageFeatures;
    });
};
