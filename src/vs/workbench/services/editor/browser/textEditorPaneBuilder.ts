import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import { LanguageConfigurationServiceDIToken } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenStyleResolverDIToken } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { TokenizationRegistryDIToken } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { ContextMenuController } from "../../../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import { ContextMenuControllerDIToken } from "../../../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import {
    type DocumentSemanticTokensFeature,
    DocumentSemanticTokensFeatureDIToken,
} from "../../../../editor/contrib/semanticTokens/browser/documentSemanticTokens.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorComponent } from "../../../browser/parts/editor/editorComponent.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";

export const TextEditorPaneBuilderDIToken = token<TextEditorPaneBuilder>("TextEditorPaneBuilder");

/**
 * Строит view-часть текстовой вкладки поверх готовой модели:
 * {@link EditorComponent} (токенизация, стиль токенов, языковая конфигурация,
 * folding-провайдеры) + транзитный {@link TextEditorPane} и контекстное меню
 * редактора. Модели не создаёт и настроек `editor.*` не применяет — это
 * `TextFileModelService` и `TextEditorConfiguration`.
 *
 * Не путать с фабриками вкладок по `typeId` (`IEditorPaneFactory`): те
 * описывают и восстанавливают вкладку, этот — собирает её вью.
 */
export class TextEditorPaneBuilder {
    public static dependencies = [
        TokenizationRegistryDIToken,
        TokenStyleResolverDIToken,
        LanguageConfigurationServiceDIToken,
        LanguageFeaturesServiceDIToken,
        ContextMenuControllerDIToken,
        DocumentSemanticTokensFeatureDIToken,
    ] as const;

    public constructor(
        private readonly tokenizationRegistry: TokenizationRegistry,
        private readonly tokenStyleResolver: ITokenStyleResolver,
        private readonly languageConfigurationService: ILanguageConfigurationService,
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly contextMenuController: ContextMenuController,
        private readonly semanticTokens?: DocumentSemanticTokensFeature,
    ) {}

    /**
     * Вкладка поверх модели. `modelOwnership` — ссылка реестра, которой владеет
     * вкладка; без неё вкладка владеет моделью единолично (untitled, detached).
     */
    public build<TModel extends BaseTextEditorModel>(
        model: TModel,
        modelOwnership?: IDisposable,
    ): TextEditorPane<TModel> {
        const component = new EditorComponent(
            this.tokenizationRegistry,
            this.tokenStyleResolver,
            model,
            this.languageConfigurationService,
            this.languageFeatures.foldingRangeProvider,
            this.semanticTokens,
        );
        const editor = new TextEditorPane(model, component, modelOwnership);
        // Политика контекстного меню редактора слушает "contextmenu" на обвязке
        // пары; сам элемент контроллер берёт из цели события.
        this.contextMenuController.attach(component.view);
        return editor;
    }
}
