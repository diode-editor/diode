import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IRange } from "../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type {
    ICallHierarchyIncomingCall,
    ICallHierarchyOutgoingCall,
    ICallHierarchyRequest,
    ICallHierarchySession,
} from "../../../editor/common/languages/iCallHierarchySource.ts";
import type {
    IApplyCodeActionOptions,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../../editor/common/languages/iCodeActionSource.ts";
import type { ICodeLensRequest } from "../../../editor/common/languages/iCodeLensSource.ts";
import type { IColorInformation, IDocumentColorRequest } from "../../../editor/common/languages/iColorSource.ts";
import type {
    ICompletionRequest,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import type {
    ICoreDefinitionLocation,
    IDefinitionRequest,
} from "../../../editor/common/languages/iDefinitionSource.ts";
import type {
    IDocumentHighlight,
    IDocumentHighlightRequest,
} from "../../../editor/common/languages/iDocumentHighlightSource.ts";
import type { IFoldingRequest } from "../../../editor/common/languages/iFoldingSource.ts";
import type {
    IFormattingRequest,
    IOnTypeFormattingRequest,
} from "../../../editor/common/languages/iFormattingSource.ts";
import type { ICoreHover, IHoverRequest } from "../../../editor/common/languages/iHoverSource.ts";
import type { IInlayHintsRequest, InlayHint } from "../../../editor/common/languages/iInlayHintsSource.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
} from "../../../editor/common/languages/iInlineCompletionSource.ts";
import type {
    ILinkedEditingRangeRequest,
    ILinkedEditingRanges,
} from "../../../editor/common/languages/iLinkedEditingSource.ts";
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
import type {
    ITypeHierarchyItem,
    ITypeHierarchyRequest,
    ITypeHierarchySession,
} from "../../../editor/common/languages/iTypeHierarchySource.ts";
import type { IFoldingRegion } from "../../../editor/contrib/folding/iFoldingRegion.ts";

import type {
    IWireCodeLens,
    IWireCodeLensList,
    IWireLanguageProviderRegistration,
    WireCodeLensCacheId,
} from "./wireTypes.ts";

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
    provideImplementation(
        handle: number,
        request: IDefinitionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]>;
    provideTypeDefinition(
        handle: number,
        request: IDefinitionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]>;
    provideDeclaration(
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
    provideOnTypeFormattingEdits(
        handle: number,
        request: IOnTypeFormattingRequest,
        token: ICancellationToken,
    ): Promise<readonly ITextEdit[]>;
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
    prepareCallHierarchy(
        handle: number,
        request: ICallHierarchyRequest,
        token: ICancellationToken,
    ): Promise<ICallHierarchySession | null>;
    provideCallHierarchyIncomingCalls(
        handle: number,
        sessionId: number,
        itemId: number,
        token: ICancellationToken,
    ): Promise<readonly ICallHierarchyIncomingCall[]>;
    provideCallHierarchyOutgoingCalls(
        handle: number,
        sessionId: number,
        itemId: number,
        token: ICancellationToken,
    ): Promise<readonly ICallHierarchyOutgoingCall[]>;
    /** The tree is gone: the subprocess forgets the session's original items. */
    releaseCallHierarchy(handle: number, sessionId: number): void;
    prepareTypeHierarchy(
        handle: number,
        request: ITypeHierarchyRequest,
        token: ICancellationToken,
    ): Promise<ITypeHierarchySession | null>;
    provideTypeHierarchySupertypes(
        handle: number,
        sessionId: number,
        itemId: number,
        token: ICancellationToken,
    ): Promise<readonly ITypeHierarchyItem[]>;
    provideTypeHierarchySubtypes(
        handle: number,
        sessionId: number,
        itemId: number,
        token: ICancellationToken,
    ): Promise<readonly ITypeHierarchyItem[]>;
    /** The tree is gone: the subprocess forgets the session's original items. */
    releaseTypeHierarchy(handle: number, sessionId: number): void;
    /** `null`: the provider declined, the next one or the textual search takes over. */
    provideDocumentHighlights(
        handle: number,
        request: IDocumentHighlightRequest,
        token: ICancellationToken,
    ): Promise<readonly IDocumentHighlight[] | null>;
    /** `null`: the provider declined, the next one is asked. */
    provideLinkedEditingRanges(
        handle: number,
        request: ILinkedEditingRangeRequest,
        token: ICancellationToken,
    ): Promise<ILinkedEditingRanges | null>;
    /** `null`: the provider gave no colors, the default detector may take over. */
    provideDocumentColors(
        handle: number,
        request: IDocumentColorRequest,
        token: ICancellationToken,
    ): Promise<readonly IColorInformation[] | null>;
    /**
     * Document tokens; `previousResultId` is the numeric id of this provider's previous
     * response (0 if none). The response's `resultId` is the same id as a string.
     */
    provideInlayHints(
        handle: number,
        request: IInlayHintsRequest,
        token?: ICancellationToken,
    ): Promise<readonly InlayHint[] | null>;
    onDidChangeInlayHints(cb: (handle: number) => void): IDisposable;
    provideCodeLenses(
        handle: number,
        request: ICodeLensRequest,
        token?: ICancellationToken,
    ): Promise<IWireCodeLensList | null>;
    resolveCodeLens(
        handle: number,
        cacheId: WireCodeLensCacheId,
        token?: ICancellationToken,
    ): Promise<IWireCodeLens | null>;
    /** The core no longer shows the answer `cacheId`. */
    releaseCodeLenses(handle: number, cacheId: number): void;
    /** Rejects with the failure of the command. No timeout: a command may run as long as it likes. */
    executeCodeLensCommand(handle: number, cacheId: WireCodeLensCacheId): Promise<void>;
    onDidChangeCodeLenses(cb: (handle: number) => void): IDisposable;
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
