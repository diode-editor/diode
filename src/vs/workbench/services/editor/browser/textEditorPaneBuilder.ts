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
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorComponent, type IIndentConfiguration } from "../../../browser/parts/editor/editorComponent.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../notification/browser/notificationService.ts";
import { TextFileModel } from "../../textfile/common/textFileModel.ts";

import { runCodeLensCommand } from "./codeLensCommand.ts";

export const TextEditorPaneBuilderDIToken = token<TextEditorPaneBuilder>("TextEditorPaneBuilder");

/**
 * Does not create models or apply `editor.*`. Not to be confused with `IEditorPaneFactory`: those describe
 * and restore a tab, this one assembles its view.
 */
export class TextEditorPaneBuilder {
    public static dependencies = [
        TokenizationRegistryDIToken,
        TokenStyleResolverDIToken,
        LanguageConfigurationServiceDIToken,
        LanguageFeaturesServiceDIToken,
        ContextMenuControllerDIToken,
        DocumentSemanticTokensFeatureDIToken,
        CommandRegistryDIToken,
        NotificationServiceDIToken,
    ] as const;

    public constructor(
        private readonly tokenizationRegistry: TokenizationRegistry,
        private readonly tokenStyleResolver: ITokenStyleResolver,
        private readonly languageConfigurationService: ILanguageConfigurationService,
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly contextMenuController: ContextMenuController,
        private readonly semanticTokens?: DocumentSemanticTokensFeature,
        private readonly commands?: CommandRegistry,
        private readonly notifications?: NotificationService,
    ) {}

    /**
     * `modelOwnership` — the registry reference the tab owns; without it the tab owns the model exclusively.
     * `indent` — the `editor.*` indentation baseline known up front, so the view detects indentation once.
     */
    public build<TModel extends BaseTextEditorModel>(
        model: TModel,
        modelOwnership?: IDisposable,
        indent?: IIndentConfiguration,
    ): TextEditorPane<TModel> {
        const component = new EditorComponent(
            this.tokenizationRegistry,
            this.tokenStyleResolver,
            model,
            this.languageConfigurationService,
            this.languageFeatures.foldingRangeProvider,
            this.semanticTokens,
            indent,
            this.languageFeatures.colorProvider,
            // Only the file editor, as ghost text: panels and virtual documents are synthetic models.
            model instanceof TextFileModel ? this.languageFeatures.inlayHintsProvider : undefined,
            model instanceof TextFileModel
                ? {
                      providers: this.languageFeatures.codeLensProvider,
                      runCommand: (command) => runCodeLensCommand(this.commands, this.notifications, command),
                  }
                : undefined,
            this.languageFeatures.documentHighlightProvider,
        );
        const editor = new TextEditorPane(model, component, modelOwnership);
        // The editor context menu policy listens for "contextmenu" on the pair's wrapper;
        // the controller takes the element itself from the event target.
        this.contextMenuController.attach(component.view);
        return editor;
    }
}
