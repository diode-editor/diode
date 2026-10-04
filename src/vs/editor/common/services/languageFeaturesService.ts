import { LanguageFeatureRegistry } from "../languageFeatureRegistry.ts";
import type { CodeActionProvider } from "../languages/iCodeActionSource.ts";
import type { CompletionItemProvider } from "../languages/iCompletionSource.ts";
import type { DefinitionProvider } from "../languages/iDefinitionSource.ts";
import type { FoldingRangeProvider } from "../languages/iFoldingSource.ts";
import type {
    DocumentFormattingEditProvider,
    DocumentRangeFormattingEditProvider,
} from "../languages/iFormattingSource.ts";
import type { HoverProvider } from "../languages/iHoverSource.ts";
import type { InlineCompletionsProvider } from "../languages/iInlineCompletionSource.ts";
import type { ReferenceProvider } from "../languages/iReferenceSource.ts";
import type { RenameProvider } from "../languages/iRenameSource.ts";
import type { SignatureHelpProvider } from "../languages/iSignatureHelpSource.ts";

import type { ILanguageFeaturesService } from "./languageFeatures.ts";

/** Реализация {@link ILanguageFeaturesService}: по пустому реестру на фичу. */
export class LanguageFeaturesService implements ILanguageFeaturesService {
    public readonly hoverProvider = new LanguageFeatureRegistry<HoverProvider>();
    public readonly definitionProvider = new LanguageFeatureRegistry<DefinitionProvider>();
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
}
