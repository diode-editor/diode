import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { ISemanticTokenStyleResolver } from "../../../common/languages/iSemanticTokenStyleResolver.ts";

export const SEMANTIC_HIGHLIGHTING_SETTING_ID = "editor.semanticHighlighting.enabled";

/** Upstream `isSemanticColoringEnabled`: `configuredByTheme` is the active theme's flag. */
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
