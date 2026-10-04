import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { ICodeActionRequest, ICoreCodeAction } from "../../../editor/common/languages/iCodeActionSource.ts";
import type {
    ICompletionRequest,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import type {
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../editor/common/languages/iDefinitionSource.ts";
import type { IFoldingRequest } from "../../../editor/common/languages/iFoldingSource.ts";
import type { IFormattingRequest } from "../../../editor/common/languages/iFormattingSource.ts";
import type { ICoreHover, IHoverRequest } from "../../../editor/common/languages/iHoverSource.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
} from "../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ICoreReference, IReferenceRequest } from "../../../editor/common/languages/iReferenceSource.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
} from "../../../editor/common/languages/iRenameSource.ts";
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
} from "../../../editor/common/languages/iSignatureHelpSource.ts";
import type { IFoldingRegion } from "../../../editor/contrib/folding/iFoldingRegion.ts";

import type { IWireLanguageProviderRegistration } from "./wireTypes.ts";

/**
 * «Port» поверх {@link ExtensionHost}: языковые провайдеры субпроцесса и вызов
 * каждого по handle. Как {@link IExtensionFileSystemBridge}, описывает, что
 * Workbench'у нужно от host'а: реализует его сам `ExtensionHost` (структурно), а
 * в `ILanguageFeaturesService` прокси регистрирует `LanguageFeaturesAdapter`
 * (upstream `MainThreadLanguageFeatures`).
 */
export interface IExtensionLanguageFeaturesBridge {
    /** Живые регистрации провайдеров (`languages.register`). */
    getLanguageProviders(): readonly IWireLanguageProviderRegistration[];
    /** Состав регистраций изменился (регистрация, снятие, смерть субпроцесса). */
    onLanguageProvidersChanged(cb: () => void): IDisposable;
    provideHover(handle: number, request: IHoverRequest, token: ICancellationToken): Promise<ICoreHover | undefined>;
    provideDefinition(
        handle: number,
        request: IDefinitionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]>;
    provideReferences(
        handle: number,
        request: IReferenceRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreReference[]>;
    provideSignatureHelp(
        handle: number,
        request: ISignatureHelpRequest,
        token: ICancellationToken,
    ): Promise<ICoreSignatureHelp | null>;
    provideCompletionItems(
        handle: number,
        request: ICompletionRequest,
        token: ICancellationToken,
    ): Promise<ICoreCompletionResult>;
    resolveCompletionItem(id: string): Promise<ICoreResolvedCompletion | null>;
    /** С `request.range` — range-провайдер `handle`, без — документный. */
    provideFormattingEdits(
        handle: number,
        request: IFormattingRequest,
        token: ICancellationToken,
    ): Promise<readonly ITextEdit[]>;
    provideCodeActions(
        handle: number,
        request: ICodeActionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreCodeAction[]>;
    applyCodeAction(id: string): Promise<boolean>;
    provideFoldingRanges(
        handle: number,
        request: IFoldingRequest,
        token: ICancellationToken,
    ): Promise<readonly IFoldingRegion[]>;
    provideInlineCompletions(
        handle: number,
        request: IInlineCompletionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreInlineCompletionItem[]>;
    prepareRename(handle: number, request: IRenameRequest): Promise<ICoreRenameLocation | null>;
    /** Правки накладывает сам субпроцесс (`workspace.applyEdit`) — сюда едет только исход. */
    provideRenameEdits(handle: number, request: IRenameRequest, newName: string): Promise<ICoreRenameResult>;
}
