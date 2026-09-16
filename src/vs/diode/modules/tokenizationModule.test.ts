import { describe, expect, it } from "vitest";

import {
    LanguageConfigurationServiceDIToken,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../editor/common/languages/iLanguageConfigurationService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../editor/common/languages/tokenizationRegistry.ts";
import {
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../workbench/common/coreTokens.ts";

import { createTestContainer } from "./testProfile.ts";
import { tokenizationModule } from "./tokenizationModule.ts";

/**
 * Проводка языковых сервисов в DI. Проверяем не «биндинг объявлен», а что через
 * каждый токен доезжает ИМЕННО тот инстанс, который отдал владелец приложения:
 * перепутанный (или потерянный) аргумент даёт рабочий контейнер и редактор без
 * подсветки/скобок.
 */
describe("tokenizationModule", () => {
    it("отдаёт по токенам инстансы владельца приложения, а не дефолты профиля", () => {
        const { container } = createTestContainer();
        const tokenizationRegistry = new TokenizationRegistry();
        // Конфигурации языков — единственный инстанс, отличимый от NULL-заглушки
        // тестового профиля по ссылке.
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
});
