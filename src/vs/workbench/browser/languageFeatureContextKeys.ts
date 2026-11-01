import { Disposable } from "../../base/common/lifecycle.ts";
import type { ILanguageFeatureTarget } from "../../editor/common/languageFeatureRegistry.ts";
import type { ILanguageFeaturesService } from "../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

export const LanguageFeatureContextKeysDIToken = token<LanguageFeatureContextKeys>("LanguageFeatureContextKeys");

const FEATURES = [
    "definitionProvider",
    "implementationProvider",
    "referenceProvider",
    "renameProvider",
    "codeActionProvider",
    "documentFormattingEditProvider",
    "documentRangeFormattingEditProvider",
    "inlayHintsProvider",
    "codeLensProvider",
] as const;

/**
 * Upstream's `EditorContextKeys.has*Provider`: menus do not promise what does not work. Like
 * upstream, a registry change updates the keys at once: a right click isn't preceded by polling
 * before keybinding resolution, and a language server comes up with no key pressed. Without an
 * active editor all keys are `false`: otherwise they would stick from the previous document.
 */
export class LanguageFeatureContextKeys extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        EditorServiceDIToken,
        LanguageFeaturesServiceDIToken,
        ContextKeyServiceDIToken,
    ] as const;

    public constructor(
        private readonly group: IEditorService,
        private readonly languageFeatures: ILanguageFeaturesService,
        contextKeys: ContextKeyService,
    ) {
        super();
        for (const feature of FEATURES) {
            this.register(
                languageFeatures[feature].onDidChange(() => {
                    this.updateContextKeys(contextKeys);
                }),
            );
        }
    }

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
        contextKeys.set("editorHasInlayHintsProvider", this.has("inlayHintsProvider", target));
        contextKeys.set("editorHasCodeLensProvider", this.has("codeLensProvider", target));
        // Upstream hides Format Selection when there is no selection.
        const selection = editor?.viewState.selections[0];
        const empty =
            selection === undefined ||
            (selection.anchor.line === selection.active.line &&
                selection.anchor.character === selection.active.character);
        contextKeys.set("editorHasSelection", !empty);
    }

    private has(feature: (typeof FEATURES)[number], target: ILanguageFeatureTarget | null): boolean {
        return target !== null && this.languageFeatures[feature].has(target);
    }
}
