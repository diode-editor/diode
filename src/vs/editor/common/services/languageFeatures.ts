import { token } from "../../../platform/instantiation/common/diContainer.ts";
import type { LanguageFeatureRegistry } from "../languageFeatureRegistry.ts";
import type { CodeActionProvider } from "../languages/iCodeActionSource.ts";
import type { CodeLensProvider } from "../languages/iCodeLensSource.ts";
import type { DocumentColorProvider } from "../languages/iColorSource.ts";
import type { CompletionItemProvider } from "../languages/iCompletionSource.ts";
import type { DefinitionProvider, ImplementationProvider } from "../languages/iDefinitionSource.ts";
import type { FoldingRangeProvider } from "../languages/iFoldingSource.ts";
import type {
    DocumentFormattingEditProvider,
    DocumentRangeFormattingEditProvider,
} from "../languages/iFormattingSource.ts";
import type { HoverProvider } from "../languages/iHoverSource.ts";
import type { InlayHintsProvider } from "../languages/iInlayHintsSource.ts";
import type { InlineCompletionsProvider } from "../languages/iInlineCompletionSource.ts";
import type { ReferenceProvider } from "../languages/iReferenceSource.ts";
import type { RenameProvider } from "../languages/iRenameSource.ts";
import type { SelectionRangeProvider } from "../languages/iSelectionRangeSource.ts";
import type {
    DocumentRangeSemanticTokensProvider,
    DocumentSemanticTokensProvider,
} from "../languages/iSemanticTokensSource.ts";
import type { SignatureHelpProvider } from "../languages/iSignatureHelpSource.ts";

export interface ILanguageFeaturesService {
    readonly hoverProvider: LanguageFeatureRegistry<HoverProvider>;
    readonly definitionProvider: LanguageFeatureRegistry<DefinitionProvider>;
    readonly implementationProvider: LanguageFeatureRegistry<ImplementationProvider>;
    readonly referenceProvider: LanguageFeatureRegistry<ReferenceProvider>;
    readonly renameProvider: LanguageFeatureRegistry<RenameProvider>;
    readonly signatureHelpProvider: LanguageFeatureRegistry<SignatureHelpProvider>;
    readonly completionProvider: LanguageFeatureRegistry<CompletionItemProvider>;
    readonly documentFormattingEditProvider: LanguageFeatureRegistry<DocumentFormattingEditProvider>;
    readonly documentRangeFormattingEditProvider: LanguageFeatureRegistry<DocumentRangeFormattingEditProvider>;
    readonly codeActionProvider: LanguageFeatureRegistry<CodeActionProvider>;
    readonly foldingRangeProvider: LanguageFeatureRegistry<FoldingRangeProvider>;
    readonly inlineCompletionsProvider: LanguageFeatureRegistry<InlineCompletionsProvider>;
    readonly selectionRangeProvider: LanguageFeatureRegistry<SelectionRangeProvider>;
    readonly documentSemanticTokensProvider: LanguageFeatureRegistry<DocumentSemanticTokensProvider>;
    readonly documentRangeSemanticTokensProvider: LanguageFeatureRegistry<DocumentRangeSemanticTokensProvider>;
    readonly colorProvider: LanguageFeatureRegistry<DocumentColorProvider>;
    readonly inlayHintsProvider: LanguageFeatureRegistry<InlayHintsProvider>;
    readonly codeLensProvider: LanguageFeatureRegistry<CodeLensProvider>;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string is only a debug label
export const LanguageFeaturesServiceDIToken = token<ILanguageFeaturesService>("LanguageFeaturesService");
