import { LanguageFeatureRegistry } from "../languageFeatureRegistry.ts";
import type { CompletionItemProvider } from "../languages/iCompletionSource.ts";
import type { DefinitionProvider } from "../languages/iDefinitionSource.ts";
import type { HoverProvider } from "../languages/iHoverSource.ts";
import type { ReferenceProvider } from "../languages/iReferenceSource.ts";
import type { SignatureHelpProvider } from "../languages/iSignatureHelpSource.ts";

import type { ILanguageFeaturesService } from "./languageFeatures.ts";

/** Реализация {@link ILanguageFeaturesService}: по пустому реестру на фичу. */
export class LanguageFeaturesService implements ILanguageFeaturesService {
    public readonly hoverProvider = new LanguageFeatureRegistry<HoverProvider>();
    public readonly definitionProvider = new LanguageFeatureRegistry<DefinitionProvider>();
    public readonly referenceProvider = new LanguageFeatureRegistry<ReferenceProvider>();
    public readonly signatureHelpProvider = new LanguageFeatureRegistry<SignatureHelpProvider>();
    public readonly completionProvider = new LanguageFeatureRegistry<CompletionItemProvider>();
}
