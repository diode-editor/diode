import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { ISemanticTokenStyleResolver } from "../../../common/languages/iSemanticTokenStyleResolver.ts";

export const SEMANTIC_HIGHLIGHTING_SETTING_ID = "editor.semanticHighlighting.enabled";

/**
 * Включена ли семантическая подсветка документа языка `languageId`
 * (`isSemanticColoringEnabled` эталона): булево значение настройки (с учётом
 * языковой секции) решает само, `configuredByTheme` — флаг активной темы.
 */
export function isSemanticColoringEnabled(
    languageId: string,
    configuration: IConfigurationService,
    theme: ISemanticTokenStyleResolver,
): boolean {
    const setting = configuration.get(SEMANTIC_HIGHLIGHTING_SETTING_ID, { overrideIdentifier: languageId });
    if (typeof setting === "boolean") {
        return setting;
    }
    return theme.semanticHighlighting;
}
