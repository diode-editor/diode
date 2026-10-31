import type { ILanguageFeatureTarget } from "../../editor/common/languageFeatureRegistry.ts";
import type { ILanguageFeaturesService } from "../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

export const LanguageFeatureContextKeysDIToken = token<LanguageFeatureContextKeys>("LanguageFeatureContextKeys");

/**
 * Upstream's `EditorContextKeys.has*Provider`: menus do not promise what does not work. Polling
 * before keybinding resolution picks up a provider that arrived later, without
 * subscribing to the registry. Without an active editor all keys are `false`: otherwise they
 * would stick from the previous document.
 */
export class LanguageFeatureContextKeys implements IContextKeyContributor {
    public static dependencies = [EditorServiceDIToken, LanguageFeaturesServiceDIToken] as const;

    public constructor(
        private readonly group: IEditorService,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {}

    public updateContextKeys(contextKeys: ContextKeyService): void {
        const editor = this.group.getActiveEditor();
        const target: ILanguageFeatureTarget | null = editor;
        contextKeys.set("editorHasDefinitionProvider", this.has("definitionProvider", target));
        contextKeys.set("editorHasImplementationProvider", this.has("implementationProvider", target));
        contextKeys.set("editorHasReferenceProvider", this.has("referenceProvider", target));
        contextKeys.set("editorHasRenameProvider", this.has("renameProvider", target));
        contextKeys.set("editorHasCodeActionsProvider", this.has("codeActionProvider", target));
        contextKeys.set("editorHasDocumentFormattingProvider", this.has("documentFormattingEditProvider", target));
        contextKeys.set(
            "editorHasDocumentSelectionFormattingProvider",
            this.has("documentRangeFormattingEditProvider", target),
        );
        // Upstream hides Format Selection when there is no selection.
        const selection = editor?.viewState.selections[0];
        const empty =
            selection === undefined ||
            (selection.anchor.line === selection.active.line &&
                selection.anchor.character === selection.active.character);
        contextKeys.set("editorHasSelection", !empty);
    }

    private has(
        feature:
            | "definitionProvider"
            | "implementationProvider"
            | "referenceProvider"
            | "renameProvider"
            | "codeActionProvider"
            | "documentFormattingEditProvider"
            | "documentRangeFormattingEditProvider",
        target: ILanguageFeatureTarget | null,
    ): boolean {
        return target !== null && this.languageFeatures[feature].has(target);
    }
}
