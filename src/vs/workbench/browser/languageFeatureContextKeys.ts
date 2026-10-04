import type { ILanguageFeatureTarget } from "../../editor/common/languageFeatureRegistry.ts";
import type { ILanguageFeaturesService } from "../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";
import type { IContextKeyContributor } from "../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

export const LanguageFeatureContextKeysDIToken = token<LanguageFeatureContextKeys>("LanguageFeatureContextKeys");

/**
 * Ключи «у документа есть провайдер такой-то фичи» (upstream
 * `EditorContextKeys.has*Provider`): их читают when-клаузы пунктов
 * контекст-меню редактора, чтобы меню не обещало нерабочее — «Go to
 * Definition» в .txt без языкового сервера пункта не даёт.
 *
 * Считаются по реестрам `ILanguageFeaturesService` для документа АКТИВНОГО
 * редактора — ровно так же, как их потом спросит сама команда. Опрос (как у
 * всех {@link IContextKeyContributor}) идёт перед резолвом биндинга и на смене
 * фокуса: провайдер, приехавший позже (language server поднялся через
 * секунду), подхватывается на следующем же обращении, без подписки на реестр.
 *
 * Без активного редактора все ключи — `false`: иначе они залипали бы от
 * прошлого документа и меню показывало бы пункты чужого языка.
 */
export class LanguageFeatureContextKeys implements IContextKeyContributor {
    public static dependencies = [EditorServiceDIToken, LanguageFeaturesServiceDIToken] as const;

    public constructor(
        private readonly group: EditorService,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {}

    public updateContextKeys(contextKeys: ContextKeyService): void {
        const editor = this.group.getActiveEditor();
        const target: ILanguageFeatureTarget | null = editor;
        contextKeys.set("editorHasDefinitionProvider", this.has("definitionProvider", target));
        contextKeys.set("editorHasReferenceProvider", this.has("referenceProvider", target));
        contextKeys.set("editorHasRenameProvider", this.has("renameProvider", target));
        contextKeys.set("editorHasCodeActionsProvider", this.has("codeActionProvider", target));
        contextKeys.set("editorHasDocumentFormattingProvider", this.has("documentFormattingEditProvider", target));
        contextKeys.set(
            "editorHasDocumentSelectionFormattingProvider",
            this.has("documentRangeFormattingEditProvider", target),
        );
        // Непустое выделение: на нём висит Format Selection — пункт «отформатировать
        // выделенное» без выделения в эталоне не показывается.
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
