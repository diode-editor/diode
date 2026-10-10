import { describe, expect, it } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import {
    type ISemanticTokenStyleResolver,
    NULL_SEMANTIC_TOKEN_STYLE_RESOLVER,
} from "../../../common/languages/iSemanticTokenStyleResolver.ts";

import { isSemanticColoringEnabled, SEMANTIC_HIGHLIGHTING_SETTING_ID } from "./semanticTokensConfig.ts";

const THEME_ON: ISemanticTokenStyleResolver = { ...NULL_SEMANTIC_TOKEN_STYLE_RESOLVER, semanticHighlighting: true };
const THEME_OFF = NULL_SEMANTIC_TOKEN_STYLE_RESOLVER;

describe("isSemanticColoringEnabled", () => {
    it("ключ — editor.semanticHighlighting.enabled", () => {
        expect(SEMANTIC_HIGHLIGHTING_SETTING_ID).toBe("editor.semanticHighlighting.enabled");
    });

    it("дефолт configuredByTheme — решает флаг темы", () => {
        const configuration = createTestConfigurationService();
        expect(configuration.get(SEMANTIC_HIGHLIGHTING_SETTING_ID)).toBe("configuredByTheme");
        expect(isSemanticColoringEnabled("java", configuration, THEME_ON)).toBe(true);
        expect(isSemanticColoringEnabled("java", configuration, THEME_OFF)).toBe(false);
    });

    it("булево значение настройки решает само, независимо от темы", () => {
        expect(
            isSemanticColoringEnabled(
                "java",
                createTestConfigurationService({ [SEMANTIC_HIGHLIGHTING_SETTING_ID]: false }),
                THEME_ON,
            ),
        ).toBe(false);
        expect(
            isSemanticColoringEnabled(
                "java",
                createTestConfigurationService({ [SEMANTIC_HIGHLIGHTING_SETTING_ID]: true }),
                THEME_OFF,
            ),
        ).toBe(true);
    });

    it("языковая секция переопределяет значение для своего языка", () => {
        const configuration = createTestConfigurationService({
            "[java]": { [SEMANTIC_HIGHLIGHTING_SETTING_ID]: false },
        });
        expect(isSemanticColoringEnabled("java", configuration, THEME_ON)).toBe(false);
        expect(isSemanticColoringEnabled("typescript", configuration, THEME_ON)).toBe(true);
    });
});
