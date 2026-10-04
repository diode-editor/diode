import { token } from "../../../platform/instantiation/common/diContainer.ts";
import type { LanguageFeatureRegistry } from "../languageFeatureRegistry.ts";
import type { CodeActionProvider } from "../languages/iCodeActionSource.ts";
import type { CompletionItemProvider } from "../languages/iCompletionSource.ts";
import type { DefinitionProvider } from "../languages/iDefinitionSource.ts";
import type { FoldingRangeProvider } from "../languages/iFoldingSource.ts";
import type {
    DocumentFormattingEditProvider,
    DocumentRangeFormattingEditProvider,
} from "../languages/iFormattingSource.ts";
import type { HoverProvider } from "../languages/iHoverSource.ts";
import type { ReferenceProvider } from "../languages/iReferenceSource.ts";
import type { SignatureHelpProvider } from "../languages/iSignatureHelpSource.ts";

/**
 * Реестры языковых провайдеров ядра (upstream
 * `vs/editor/common/services/languageFeatures.ts`): по реестру на фичу.
 * Провайдеры extension host'а регистрируются сюда прокси по handle, встроенные
 * провайдеры ядра — тем же путём; потребители спрашивают `ordered(document)`.
 *
 * Поля добавляются по мере переезда фич с полей-швов `EditorService`
 * (docs/TODO — G2).
 */
export interface ILanguageFeaturesService {
    readonly hoverProvider: LanguageFeatureRegistry<HoverProvider>;
    readonly definitionProvider: LanguageFeatureRegistry<DefinitionProvider>;
    readonly referenceProvider: LanguageFeatureRegistry<ReferenceProvider>;
    readonly signatureHelpProvider: LanguageFeatureRegistry<SignatureHelpProvider>;
    readonly completionProvider: LanguageFeatureRegistry<CompletionItemProvider>;
    readonly documentFormattingEditProvider: LanguageFeatureRegistry<DocumentFormattingEditProvider>;
    readonly documentRangeFormattingEditProvider: LanguageFeatureRegistry<DocumentRangeFormattingEditProvider>;
    readonly codeActionProvider: LanguageFeatureRegistry<CodeActionProvider>;
    readonly foldingRangeProvider: LanguageFeatureRegistry<FoldingRangeProvider>;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const LanguageFeaturesServiceDIToken = token<ILanguageFeaturesService>("LanguageFeaturesService");
