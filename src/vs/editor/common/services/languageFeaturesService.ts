import { LanguageFeatureRegistry } from "../languageFeatureRegistry.ts";
import type { CallHierarchyProvider } from "../languages/iCallHierarchySource.ts";
import type { CodeActionProvider } from "../languages/iCodeActionSource.ts";
import type { CodeLensProvider } from "../languages/iCodeLensSource.ts";
import type { DocumentColorProvider } from "../languages/iColorSource.ts";
import type { CompletionItemProvider } from "../languages/iCompletionSource.ts";
import type {
    DeclarationProvider,
    DefinitionProvider,
    ImplementationProvider,
    TypeDefinitionProvider,
} from "../languages/iDefinitionSource.ts";
import type { DocumentHighlightProvider } from "../languages/iDocumentHighlightSource.ts";
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

import type { ILanguageFeaturesService } from "./languageFeatures.ts";

export class LanguageFeaturesService implements ILanguageFeaturesService {
    public readonly hoverProvider = new LanguageFeatureRegistry<HoverProvider>();
    public readonly definitionProvider = new LanguageFeatureRegistry<DefinitionProvider>();
    public readonly implementationProvider = new LanguageFeatureRegistry<ImplementationProvider>();
    public readonly typeDefinitionProvider = new LanguageFeatureRegistry<TypeDefinitionProvider>();
    public readonly declarationProvider = new LanguageFeatureRegistry<DeclarationProvider>();
    public readonly referenceProvider = new LanguageFeatureRegistry<ReferenceProvider>();
    public readonly renameProvider = new LanguageFeatureRegistry<RenameProvider>();
    public readonly signatureHelpProvider = new LanguageFeatureRegistry<SignatureHelpProvider>();
    public readonly completionProvider = new LanguageFeatureRegistry<CompletionItemProvider>();
    public readonly documentFormattingEditProvider = new LanguageFeatureRegistry<DocumentFormattingEditProvider>();
    public readonly documentRangeFormattingEditProvider =
        new LanguageFeatureRegistry<DocumentRangeFormattingEditProvider>();
    public readonly codeActionProvider = new LanguageFeatureRegistry<CodeActionProvider>();
    public readonly foldingRangeProvider = new LanguageFeatureRegistry<FoldingRangeProvider>();
    public readonly inlineCompletionsProvider = new LanguageFeatureRegistry<InlineCompletionsProvider>();
    public readonly selectionRangeProvider = new LanguageFeatureRegistry<SelectionRangeProvider>();
    public readonly documentHighlightProvider = new LanguageFeatureRegistry<DocumentHighlightProvider>();
    public readonly documentSemanticTokensProvider = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();
    public readonly documentRangeSemanticTokensProvider =
        new LanguageFeatureRegistry<DocumentRangeSemanticTokensProvider>();
    public readonly colorProvider = new LanguageFeatureRegistry<DocumentColorProvider>();
    public readonly inlayHintsProvider = new LanguageFeatureRegistry<InlayHintsProvider>();
    public readonly codeLensProvider = new LanguageFeatureRegistry<CodeLensProvider>();
    public readonly callHierarchyProvider = new LanguageFeatureRegistry<CallHierarchyProvider>();
}
