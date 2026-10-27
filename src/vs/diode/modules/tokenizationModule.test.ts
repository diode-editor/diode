import { describe, expect, it } from "vitest";

import { Uri } from "../../base/common/uri.ts";
import {
    LanguageConfigurationServiceDIToken,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../editor/common/languages/iLanguageService.ts";
import {
    NULL_SEMANTIC_TOKEN_STYLE_RESOLVER,
    SemanticTokenStyleResolverDIToken,
} from "../../editor/common/languages/iSemanticTokenStyleResolver.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenStyleResolverDIToken } from "../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import { TokenizationRegistryDIToken } from "../../editor/common/languages/tokenizationRegistry.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../editor/common/services/languageFeaturesService.ts";
import { DefaultDocumentColorProvider } from "../../editor/contrib/colorPicker/browser/defaultDocumentColorProvider.ts";

import { createTestContainer } from "./testProfile.ts";
import { tokenizationModule } from "./tokenizationModule.ts";

/** A swapped argument yields a working container and an editor without highlighting or brackets. */
describe("tokenizationModule", () => {
    it("tokens resolve to the app owner's instances, not profile defaults", () => {
        const { container } = createTestContainer();
        const tokenizationRegistry = new TokenizationRegistry();
        // Language configuration is the only instance distinguishable by reference from the test
        // profile's NULL stub.
        const languageConfigurationService = { ...NULL_LANGUAGE_CONFIGURATION_SERVICE };

        container.use(tokenizationModule, {
            tokenizationRegistry,
            tokenStyleResolver: NULL_TOKEN_STYLE_RESOLVER,
            languageService: NULL_LANGUAGE_SERVICE,
            languageConfigurationService,
        });

        expect(container.get(TokenizationRegistryDIToken)).toBe(tokenizationRegistry);
        expect(container.get(TokenStyleResolverDIToken)).toBe(NULL_TOKEN_STYLE_RESOLVER);
        expect(container.get(LanguageServiceDIToken)).toBe(NULL_LANGUAGE_SERVICE);
        expect(container.get(LanguageConfigurationServiceDIToken)).toBe(languageConfigurationService);
    });

    it("semantic style resolver: from the owner, NULL without one", () => {
        expect(createTestContainer().container.get(SemanticTokenStyleResolverDIToken)).toBe(
            NULL_SEMANTIC_TOKEN_STYLE_RESOLVER,
        );

        const { container } = createTestContainer();
        const semanticTokenStyleResolver = { ...NULL_SEMANTIC_TOKEN_STYLE_RESOLVER };
        container.use(tokenizationModule, {
            tokenizationRegistry: new TokenizationRegistry(),
            tokenStyleResolver: NULL_TOKEN_STYLE_RESOLVER,
            semanticTokenStyleResolver,
            languageService: NULL_LANGUAGE_SERVICE,
            languageConfigurationService: NULL_LANGUAGE_CONFIGURATION_SERVICE,
        });
        expect(container.get(SemanticTokenStyleResolverDIToken)).toBe(semanticTokenStyleResolver);
    });

    it("language provider registries — one instance per container, start empty", () => {
        const { container } = createTestContainer();
        const service = container.get(LanguageFeaturesServiceDIToken);

        expect(service).toBeInstanceOf(LanguageFeaturesService);
        expect(container.get(LanguageFeaturesServiceDIToken)).toBe(service);
        expect(service.hoverProvider.has({ uri: Uri.file("/a.ts"), languageId: "typescript" })).toBe(false);
    });

    it("the color registry starts with the built-in detector, for any document", () => {
        const service = createTestContainer().container.get(LanguageFeaturesServiceDIToken);
        for (const target of [
            { uri: Uri.file("/a.css"), languageId: "css" },
            { uri: Uri.from({ scheme: "output", path: "log" }), languageId: "log" },
        ]) {
            const providers = service.colorProvider.ordered(target);
            expect(providers).toHaveLength(1);
            expect(providers[0]).toBeInstanceOf(DefaultDocumentColorProvider);
        }
    });
});
