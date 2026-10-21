import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IRange } from "../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type {
    IApplyCodeActionOptions,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../../editor/common/languages/iCodeActionSource.ts";
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
import type { ISelectionRangeRequest } from "../../../editor/common/languages/iSelectionRangeSource.ts";
import type {
    IRangeSemanticTokensRequest,
    ISemanticTokens,
    ISemanticTokensEdits,
    ISemanticTokensRequest,
} from "../../../editor/common/languages/iSemanticTokensSource.ts";
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
} from "../../../editor/common/languages/iSignatureHelpSource.ts";
import type { IFoldingRegion } from "../../../editor/contrib/folding/iFoldingRegion.ts";

import type { IWireLanguageProviderRegistration } from "./wireTypes.ts";

/**
 * `ExtensionHost` implements it structurally; `LanguageFeaturesAdapter` registers the proxies
 * in `ILanguageFeaturesService` (upstream `MainThreadLanguageFeatures`).
 */
export interface IExtensionLanguageFeaturesBridge {
    getLanguageProviders(): readonly IWireLanguageProviderRegistration[];
    /** Including when the subprocess dies. */
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
    /** With `request.range`, the range provider `handle`; without it, the document one. */
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
    applyCodeAction(id: string, options?: IApplyCodeActionOptions): Promise<boolean>;
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
    /** The subprocess applies the edits itself (`workspace.applyEdit`); only the outcome comes here. */
    provideRenameEdits(handle: number, request: IRenameRequest, newName: string): Promise<ICoreRenameResult>;
    provideSelectionRanges(
        handle: number,
        request: ISelectionRangeRequest,
        token: ICancellationToken,
    ): Promise<readonly (readonly IRange[])[]>;
    /**
     * Document tokens; `previousResultId` is the numeric id of this provider's previous
     * response (0 if none). The response's `resultId` is the same id as a string.
     */
    provideDocumentSemanticTokens(
        handle: number,
        request: ISemanticTokensRequest,
        previousResultId: number,
        token: ICancellationToken,
    ): Promise<ISemanticTokens | ISemanticTokensEdits | null>;
    provideDocumentRangeSemanticTokens(
        handle: number,
        request: IRangeSemanticTokensRequest,
        token: ICancellationToken,
    ): Promise<ISemanticTokens | null>;
    /** The core no longer needs response `resultId` (`$releaseDocumentSemanticTokens`). */
    releaseDocumentSemanticTokens(handle: number, resultId: number): void;
    onDidChangeSemanticTokens(cb: (handle: number) => void): IDisposable;
}
