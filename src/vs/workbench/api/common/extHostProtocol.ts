import type { IRange } from "../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type {
    ICallHierarchyIncomingCall,
    ICallHierarchyOutgoingCall,
    ICallHierarchySession,
} from "../../../editor/common/languages/iCallHierarchySource.ts";
import type { IColorInformation } from "../../../editor/common/languages/iColorSource.ts";
import type {
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation } from "../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreDocumentSymbol } from "../../../editor/common/languages/iDocumentSymbolSource.ts";
import type { ICoreHover } from "../../../editor/common/languages/iHoverSource.ts";
import type { ICoreInlineCompletionItem } from "../../../editor/common/languages/iInlineCompletionSource.ts";
import type { InlineValue } from "../../../editor/common/languages/iInlineValuesSource.ts";
import type { ICoreReference } from "../../../editor/common/languages/iReferenceSource.ts";
import type { ICoreSignatureHelp } from "../../../editor/common/languages/iSignatureHelpSource.ts";
import type {
    ITypeHierarchyItem,
    ITypeHierarchySession,
} from "../../../editor/common/languages/iTypeHierarchySource.ts";
import type {
    IFileIndexRequest,
    IFileIndexResult,
    IFileQueryRequest,
    IFileQueryResult,
} from "../../services/search/common/fileSearch.ts";

import type {
    IWireDebugActiveSession,
    IWireDebugAdapterError,
    IWireDebugAdapterExit,
    IWireDebugAdapterHandle,
    IWireDebugAdapterMessage,
    IWireDebugBreakpointsDelta,
    IWireDebugConfigurationProvider,
    IWireDebugConsoleAppend,
    IWireDebugCustomRequest,
    IWireDebugCustomResponse,
    IWireDebugProtocolBreakpoint,
    IWireDebugProtocolBreakpointRequest,
    IWireDebugProvideConfigurations,
    IWireDebugProviderHandle,
    IWireDebugRegisterBreakpoints,
    IWireDebugResolveConfiguration,
    IWireDebugResolveResult,
    IWireDebugSessionCustomEvent,
    IWireDebugSessionEvent,
    IWireDebugSessionName,
    IWireDebugSetSessionName,
    IWireDebugStackFocus,
    IWireDebugStartAdapter,
    IWireDebugStartDebugging,
    IWireDebugStopDebugging,
    IWireDebugTypes,
    IWireDebugUnregisterBreakpoints,
    WireDebugConfiguration,
} from "./debugWireTypes.ts";
import type { IActiveEditorMeta, IActiveEditorSelections } from "./iEditorOptionsService.ts";
import type { RpcEndpoint } from "./rpcEndpoint.ts";
import type {
    IWireTask,
    IWireTaskEnded,
    IWireTaskExecution,
    IWireTaskExecutionId,
    IWireTaskFilter,
    IWireTaskProcessEnded,
    IWireTaskProcessStarted,
    IWireTaskProviderHandle,
    IWireTaskProviderRegistration,
    IWireTaskStarted,
    WireTaskExecuteRequest,
} from "./taskWireTypes.ts";
import type {
    IWireAddTestsToRun,
    IWireCancelTestRun,
    IWireExpandTest,
    IWireExtensionTestRun,
    IWireRunControllerTests,
    IWireRunControllerTestsResult,
    IWireTestController,
    IWireTestControllerId,
    IWireTestControllerPatch,
    IWireTestMessagesInRun,
    IWireTestOutputInRun,
    IWireTestRunId,
    IWireTestRunProfile,
    IWireTestRunProfileId,
    IWireTestRunProfileUpdate,
    IWireTestRunTask,
    IWireTestRunTaskId,
    IWireTestsDiff,
    IWireTestStateInRun,
} from "./testingWireTypes.ts";
import type {
    IWireTreeItem,
    IWireTreeViewExpansion,
    IWireTreeViewGetChildren,
    IWireTreeViewId,
    IWireTreeViewItemRef,
    IWireTreeViewMessage,
    IWireTreeViewRefresh,
    IWireTreeViewRegistration,
    IWireTreeViewReveal,
    IWireTreeViewSelection,
    IWireTreeViewTitle,
    IWireTreeViewVisibility,
} from "./treeViewWireTypes.ts";
import type {
    IWireActivateExtensionParams,
    IWireApplyEditParams,
    IWireApplyWorkspaceEditParams,
    IWireCallHierarchyCallsParams,
    IWireChangedFiles,
    IWireChangeLanguageParams,
    IWireChangeLanguageResult,
    IWireClipboardText,
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCodeActionParams,
    IWireCodeLens,
    IWireCodeLensAddress,
    IWireCodeLensList,
    IWireCodeLensParams,
    IWireColorTheme,
    IWireCommandId,
    IWireCompletionParams,
    IWireConfigurationChanged,
    IWireConfigurationUpdate,
    IWireCreateContributedProfileTerminal,
    IWireCreateDecorationType,
    IWireCreateUntitledParams,
    IWireDefinitionParams,
    IWireDiagnosticsPublish,
    IWireDidSaveParams,
    IWireDisposeDecorationType,
    IWireDocumentChangedEvent,
    IWireDocumentColorParams,
    IWireDocumentHighlight,
    IWireDocumentHighlightParams,
    IWireDocumentLanguage,
    IWireDocumentLinkList,
    IWireDocumentLinksParams,
    IWireDocumentSemanticTokensParams,
    IWireDocumentStateChanged,
    IWireDocumentSymbolParams,
    IWireDocumentSyncSnapshot,
    IWireEditorLayout,
    IWireEditorPropertiesChanged,
    IWireEnvInitialize,
    IWireEnvironmentVariableCollections,
    IWireEnvLogLevel,
    IWireEvaluatableExpression,
    IWireEvaluatableExpressionParams,
    IWireExecuteCommandParams,
    IWireExtensionCatalog,
    IWireExtensionId,
    IWireFileDecorationProvider,
    IWireFileDecorationProviderHandle,
    IWireFileDecorationsChanged,
    IWireFileOperationEvent,
    IWireFileOperationParams,
    IWireFileOperationSubscriptions,
    IWireFileStat,
    IWireFileSystemSchemes,
    IWireFoldingParams,
    IWireFormattingParams,
    IWireHandleUri,
    IWireHoverParams,
    IWireInlayHint,
    IWireInlayHintsParams,
    IWireInlineCompletionParams,
    IWireInlineValuesParams,
    IWireInputBoxRequest,
    IWireInputBoxResult,
    IWireInputBoxValidate,
    IWireInsertSnippetParams,
    IWireLanguageConfiguration,
    IWireLanguageProviderRegistration,
    IWireLanguageProviderUnregistration,
    IWireLanguageStatusItem,
    IWireLinkedEditingRangeParams,
    IWireLinkedEditingRanges,
    IWireMarkersChanged,
    IWireMementoUpdate,
    IWireOnTypeFormattingParams,
    IWireOpenDialogRequest,
    IWireOpenDialogResult,
    IWireOpenExternalResult,
    IWireOpenTextDocumentParams,
    IWireOutputAppend,
    IWireOutputShow,
    IWirePrepareCallHierarchyParams,
    IWirePrepareRenameParams,
    IWirePrepareTypeHierarchyParams,
    IWireProgressCancel,
    IWireProgressEnd,
    IWireProgressReport,
    IWireProgressStart,
    IWireProvideFileDecorations,
    IWireProviderHandle,
    IWireQuickInputCancel,
    IWireQuickPickDidSelectItem,
    IWireQuickPickDispose,
    IWireQuickPickEvent,
    IWireQuickPickItems,
    IWireQuickPickRequest,
    IWireQuickPickResult,
    IWireQuickPickUpdate,
    IWireRangeSemanticTokensParams,
    IWireReadFileResult,
    IWireReferenceParams,
    IWireRegisterCommandParams,
    IWireReleaseCallHierarchy,
    IWireReleaseCodeLenses,
    IWireReleaseSemanticTokens,
    IWireReleaseTypeHierarchy,
    IWireRenameParams,
    IWireResolveDocumentLinkParams,
    IWireResolvedWorkspaceSymbol,
    IWireResolveWorkspaceSymbolParams,
    IWireRevealRange,
    IWireSaveAllParams,
    IWireSaveDialogRequest,
    IWireSaveDialogResult,
    IWireSaveResult,
    IWireSchemes,
    IWireSecretKeys,
    IWireSecretKeysRequest,
    IWireSecretRef,
    IWireSecretValue,
    IWireSecretWrite,
    IWireSelectionRangeParams,
    IWireSetDecorations,
    IWireSetEditorOptionsParams,
    IWireSetEnvironmentVariableCollection,
    IWireSetSelectionParams,
    IWireShowMessageRequest,
    IWireShowMessageResult,
    IWireShowTextDocumentParams,
    IWireShowTextDocumentResult,
    IWireSignatureHelpParams,
    IWireStatusBarItem,
    IWireStatusBarItemDispose,
    IWireSubscriptions,
    IWireTerminalActive,
    IWireTerminalClosed,
    IWireTerminalCreate,
    IWireTerminalExecuteCommand,
    IWireTerminalInteraction,
    IWireTerminalOpened,
    IWireTerminalProfileProvider,
    IWireTerminalPtyData,
    IWireTerminalPtyDimensions,
    IWireTerminalPtyExit,
    IWireTerminalPtyInput,
    IWireTerminalPtyName,
    IWireTerminalSendText,
    IWireTerminalShellExecutionData,
    IWireTerminalShellExecutionEnd,
    IWireTerminalShellExecutionStart,
    IWireTerminalShellIntegration,
    IWireTerminalShellIntegrationCwd,
    IWireTerminalShellIntegrationEnv,
    IWireTerminalShow,
    IWireTerminalTarget,
    IWireTerminalTitleChanged,
    IWireTextContentResult,
    IWireTypeHierarchyParams,
    IWireUpdateWorkspaceFolders,
    IWireUriHandlerRegistration,
    IWireUriParams,
    IWireValidationMessage,
    IWireWatcherCreate,
    IWireWatcherDispose,
    IWireWatcherEvents,
    IWireWillSaveParams,
    IWireWindowActive,
    IWireWindowFocus,
    IWireWorkspaceEditOp,
    IWireWorkspaceInitialize,
    IWireWorkspaceSymbolProviderRegistration,
    IWireWorkspaceSymbols,
    IWireWorkspaceSymbolsParams,
    IWireWriteFileParams,
    WireCodeAction,
    WireFileDecorationReply,
    WireFoldingRange,
    WireRenamePrepare,
    WireRenameResult,
    WireSemanticTokensResult,
    WireTextEdit,
} from "./wireTypes.ts";

/**
 * Protocol map (upstream: `extHost.protocol.ts`), types only. Parameters are
 * what the sender SENDS; the receiving side may narrow its trust locally.
 * The host does not re-validate language request responses: the subprocess serializer
 * guarantees the shape. A method outside the map does not compile (except `$/cancelRequest`,
 * which `RpcEndpoint` handles).
 */

export interface IHostToSubprocess {
    readonly requests: {
        readonly "languages.provideCompletionItems": readonly [IWireCompletionParams, ICoreCompletionResult[]];
        readonly "languages.resolveCompletionItem": readonly [{ readonly id: string }, ICoreResolvedCompletion | null];
        readonly "languages.provideInlineCompletions": readonly [
            IWireInlineCompletionParams,
            ICoreInlineCompletionItem[][],
        ];
        readonly "languages.provideFoldingRanges": readonly [IWireFoldingParams, WireFoldingRange[][]];
        readonly "languages.provideDocumentSymbols": readonly [IWireDocumentSymbolParams, ICoreDocumentSymbol[]];
        readonly "languages.provideWorkspaceSymbols": readonly [IWireWorkspaceSymbolsParams, IWireWorkspaceSymbols];
        readonly "languages.resolveWorkspaceSymbol": readonly [
            IWireResolveWorkspaceSymbolParams,
            IWireResolvedWorkspaceSymbol | null,
        ];
        readonly "languages.provideDocumentSemanticTokens": readonly [
            IWireDocumentSemanticTokensParams,
            WireSemanticTokensResult | null,
        ];
        readonly "languages.provideDocumentRangeSemanticTokens": readonly [
            IWireRangeSemanticTokensParams,
            WireSemanticTokensResult | null,
        ];
        readonly "languages.provideDefinition": readonly [IWireDefinitionParams, ICoreDefinitionLocation[]];
        readonly "languages.provideImplementation": readonly [IWireDefinitionParams, ICoreDefinitionLocation[]];
        readonly "languages.provideTypeDefinition": readonly [IWireDefinitionParams, ICoreDefinitionLocation[]];
        readonly "languages.provideDeclaration": readonly [IWireDefinitionParams, ICoreDefinitionLocation[]];
        readonly "languages.provideHover": readonly [IWireHoverParams, ICoreHover | null];
        readonly "languages.provideReferences": readonly [IWireReferenceParams, ICoreReference[]];
        readonly "languages.provideSignatureHelp": readonly [IWireSignatureHelpParams, ICoreSignatureHelp | null];
        readonly "languages.provideFormattingEdits": readonly [IWireFormattingParams, ITextEdit[]];
        readonly "languages.provideOnTypeFormattingEdits": readonly [IWireOnTypeFormattingParams, ITextEdit[]];
        readonly "languages.provideCodeActions": readonly [IWireCodeActionParams, WireCodeAction[]];
        readonly "languages.applyCodeAction": readonly [{ readonly id: string; readonly onSave?: boolean }, boolean];
        readonly "languages.prepareRename": readonly [IWirePrepareRenameParams, WireRenamePrepare | null];
        readonly "languages.provideRenameEdits": readonly [IWireRenameParams, WireRenameResult];
        readonly "languages.provideSelectionRanges": readonly [IWireSelectionRangeParams, IRange[][]];
        readonly "languages.provideDocumentHighlights": readonly [
            IWireDocumentHighlightParams,
            IWireDocumentHighlight[] | null,
        ];
        readonly "languages.provideEvaluatableExpression": readonly [
            IWireEvaluatableExpressionParams,
            IWireEvaluatableExpression | null,
        ];
        readonly "languages.provideLinkedEditingRanges": readonly [
            IWireLinkedEditingRangeParams,
            IWireLinkedEditingRanges | null,
        ];
        readonly "languages.provideDocumentColors": readonly [IWireDocumentColorParams, IColorInformation[] | null];
        readonly "languages.provideDocumentLinks": readonly [IWireDocumentLinksParams, IWireDocumentLinkList | null];
        readonly "languages.resolveDocumentLink": readonly [IWireResolveDocumentLinkParams, string | null];
        readonly "languages.provideInlayHints": readonly [IWireInlayHintsParams, IWireInlayHint[] | null];
        readonly "languages.provideInlineValues": readonly [IWireInlineValuesParams, InlineValue[] | null];
        readonly "languages.prepareCallHierarchy": readonly [
            IWirePrepareCallHierarchyParams,
            ICallHierarchySession | null,
        ];
        readonly "languages.provideCallHierarchyIncomingCalls": readonly [
            IWireCallHierarchyCallsParams,
            ICallHierarchyIncomingCall[],
        ];
        readonly "languages.provideCallHierarchyOutgoingCalls": readonly [
            IWireCallHierarchyCallsParams,
            ICallHierarchyOutgoingCall[],
        ];
        readonly "languages.prepareTypeHierarchy": readonly [
            IWirePrepareTypeHierarchyParams,
            ITypeHierarchySession | null,
        ];
        readonly "languages.provideTypeHierarchySupertypes": readonly [IWireTypeHierarchyParams, ITypeHierarchyItem[]];
        readonly "languages.provideTypeHierarchySubtypes": readonly [IWireTypeHierarchyParams, ITypeHierarchyItem[]];
        readonly "languages.provideCodeLenses": readonly [IWireCodeLensParams, IWireCodeLensList | null];
        readonly "languages.resolveCodeLens": readonly [IWireCodeLensAddress, IWireCodeLens | null];
        readonly "languages.executeCodeLensCommand": readonly [IWireCodeLensAddress, undefined];

        readonly "workspace.fs.readFile": readonly [IWireUriParams, IWireReadFileResult];
        readonly "workspace.fs.stat": readonly [IWireUriParams, IWireFileStat | null];
        /** Upstream `$writeFile`. */
        readonly "workspace.fs.writeFile": readonly [IWireWriteFileParams, null];
        readonly "workspace.provideTextDocumentContent": readonly [IWireUriParams, IWireTextContentResult];
        readonly "workspace.willSaveTextDocument": readonly [IWireWillSaveParams, WireTextEdit[]];
        /** Upstream `$onWillRunFileOperation`; the reply is the edits of the `waitUntil`s, in listener order. */
        readonly "workspace.willRunFileOperation": readonly [IWireFileOperationParams, IWireWorkspaceEditOp[]];

        readonly "commands.executeCommand": readonly [IWireExecuteCommandParams, unknown];

        readonly "window.inputBox.validate": readonly [IWireInputBoxValidate, IWireValidationMessage | null];
        /** Upstream `$provideDecorations`; an unknown or removed handle answers `{}`. */
        readonly "window.provideFileDecorations": readonly [IWireProvideFileDecorations, WireFileDecorationReply];
        /** Responds once the handler has finished. */
        readonly "window.handleUri": readonly [IWireHandleUri, null];

        readonly "tasks.provideTasks": readonly [IWireTaskProviderHandle, IWireTask[]];

        /** Upstream `$provideDebugConfigurations`; rejects without the provider or its method, or with no result. */
        readonly "debug.provideConfigurations": readonly [IWireDebugProvideConfigurations, WireDebugConfiguration[]];
        /** Upstream `$resolveDebugConfiguration`; rejects without the provider or its method. */
        readonly "debug.resolveConfiguration": readonly [IWireDebugResolveConfiguration, IWireDebugResolveResult];
        readonly "debug.resolveConfigurationWithSubstitutedVariables": readonly [
            IWireDebugResolveConfiguration,
            IWireDebugResolveResult,
        ];
        /**
         * Upstream `$startDASession`: the descriptor of the type's factory (or the executable of `package.json`), the
         * trackers, then the adapter starts; rejects when there is no adapter or it fails to start.
         */
        readonly "debug.startAdapter": readonly [IWireDebugStartAdapter, null];
        /** Upstream `$stopDASession`: responds once the adapter has stopped; an unknown handle is no error. */
        readonly "debug.stopAdapter": readonly [IWireDebugAdapterHandle, null];

        /** Upstream `$createContributedProfileTerminal`: responds once the profile's terminal is created; rejects without a provider or options. */
        readonly "terminal.createContributedProfile": readonly [IWireCreateContributedProfileTerminal, null];

        /** Upstream `$getChildren`; rejects for a view that is not registered in the subprocess. */
        readonly "treeView.getChildren": readonly [IWireTreeViewGetChildren, IWireTreeItem[]];
        /** Runs the row's `TreeItem.command` there, with its arguments; rejects with the command's error. */
        readonly "treeView.executeCommand": readonly [IWireTreeViewItemRef, null];

        /** Upstream `$expandTest`; responds after the diff of what the `resolveHandler` calls added. */
        readonly "testing.expandTest": readonly [IWireExpandTest, null];
        /** Upstream `$refreshTests`: awaits the controller's `refreshHandler`; cancellation cancels its token. */
        readonly "testing.refreshTests": readonly [IWireTestControllerId, null];
        /**
         * Upstream `$runControllerTests`: calls each request's `runHandler`; responds once it has settled and the
         * run's `TestRun`s have ended, or as soon as it has settled after a cancellation.
         */
        readonly "testing.runControllerTests": readonly [IWireRunControllerTests, IWireRunControllerTestsResult[]];

        /**
         * Upstream `$provideFileSearchResults` of the internal file search provider: the file index lives in
         * the subprocess (#1179). Responds when the walk ends; the index answers queries before that.
         */
        readonly "search.fileIndex": readonly [IFileIndexRequest, IFileIndexResult];
        readonly "search.fileQuery": readonly [IFileQueryRequest, IFileQueryResult];

        readonly "host.activateExtension": readonly [IWireActivateExtensionParams, null];
        readonly "host.deactivateExtension": readonly [IWireExtensionId, null];
        readonly "host.shutdown": readonly [undefined, null];
    };
    readonly notifications: {
        readonly "languages.releaseDocumentSemanticTokens": IWireReleaseSemanticTokens;
        readonly "languages.releaseCallHierarchy": IWireReleaseCallHierarchy;
        readonly "languages.releaseTypeHierarchy": IWireReleaseTypeHierarchy;
        readonly "languages.releaseCodeLenses": IWireReleaseCodeLenses;
        /** Other owners' MarkerService markers: a mirror for `languages.getDiagnostics`. */
        readonly "diagnostics.markersChanged": IWireMarkersChanged;
        /** Upstream `$clearCache`: stops the walk and frees the index. */
        readonly "search.clearCache": IWireFileSearchCacheKey;

        readonly "workspace.initialize": IWireWorkspaceInitialize;
        readonly "env.initialize": IWireEnvInitialize;
        /** Upstream `$setLogLevel` without a resource: the window level changed. */
        readonly "env.didChangeLogLevel": IWireEnvLogLevel;
        readonly "workspace.configurationChanged": IWireConfigurationChanged;
        readonly "workspace.didSaveTextDocument": IWireDidSaveParams;
        /** Upstream `$onDidRunFileOperation`. */
        readonly "workspace.didRunFileOperation": IWireFileOperationEvent;
        readonly "workspace.watcher.events": IWireWatcherEvents;

        readonly "editor.didOpen": IWireDocumentSyncSnapshot;
        /** A full snapshot is a flush: the contents are replaced entirely. */
        readonly "editor.didChange": IWireDocumentChangedEvent | IWireDocumentSyncSnapshot;
        readonly "editor.didClose": IWireUriParams;
        readonly "editor.didChangeDocumentState": IWireDocumentStateChanged;
        readonly "editor.activeEditorChanged": IActiveEditorMeta;
        readonly "editor.selectionChanged": IActiveEditorSelections;
        readonly "editor.layoutChanged": IWireEditorLayout;
        /** Upstream `$acceptEditorPropertiesChanged`: after the `editor.layoutChanged` that made the editor visible. */
        readonly "editor.propertiesChanged": IWireEditorPropertiesChanged;

        readonly "window.themeChanged": IWireColorTheme;
        readonly "window.focusChanged": IWireWindowFocus;
        readonly "window.activeChanged": IWireWindowActive;
        readonly "window.quickPick.event": IWireQuickPickEvent;
        readonly "window.progress.cancel": IWireProgressCancel;
        readonly "window.showQuickPick.didSelectItem": IWireQuickPickDidSelectItem;

        readonly "secrets.changed": IWireSecretRef;

        readonly "extensions.catalog": IWireExtensionCatalog;
        readonly "extensions.activated": IWireExtensionId;

        /** Before the first activation. */
        readonly "terminal.initEnvironmentVariableCollections": IWireEnvironmentVariableCollections;
        readonly "terminal.opened": IWireTerminalOpened;
        readonly "terminal.closed": IWireTerminalClosed;
        readonly "terminal.activeChanged": IWireTerminalActive;
        readonly "terminal.pty.start": IWireTerminalPtyDimensions;
        readonly "terminal.pty.resize": IWireTerminalPtyDimensions;
        readonly "terminal.pty.input": IWireTerminalPtyInput;
        readonly "terminal.interaction": IWireTerminalInteraction;
        readonly "terminal.titleChanged": IWireTerminalTitleChanged;
        readonly "terminal.shellIntegration.changed": IWireTerminalShellIntegration;
        readonly "terminal.shellIntegration.cwd": IWireTerminalShellIntegrationCwd;
        readonly "terminal.shellIntegration.env": IWireTerminalShellIntegrationEnv;
        readonly "terminal.shellExecution.start": IWireTerminalShellExecutionStart;
        readonly "terminal.shellExecution.data": IWireTerminalShellExecutionData;
        readonly "terminal.shellExecution.end": IWireTerminalShellExecutionEnd;

        readonly "tasks.didStart": IWireTaskStarted;
        readonly "tasks.didStartProcess": IWireTaskProcessStarted;
        readonly "tasks.didEndProcess": IWireTaskProcessEnded;
        readonly "tasks.didEnd": IWireTaskEnded;

        /** Upstream `$sendDAMessage`: core → adapter; a message for an unknown handle is dropped. */
        readonly "debug.sendAdapterMessage": IWireDebugAdapterMessage;
        /** Upstream `$acceptDebugSessionStarted`: the session answered `launch`/`attach`. */
        readonly "debug.acceptSessionStarted": IWireDebugSessionEvent;
        /** Upstream `$acceptDebugSessionTerminated`; a restart ends the session too, its new run is a new one. */
        readonly "debug.acceptSessionTerminated": IWireDebugSessionEvent;
        /** Upstream `$acceptDebugSessionActiveChanged`: the focused session of the core. */
        readonly "debug.acceptActiveSessionChanged": IWireDebugActiveSession;
        readonly "debug.acceptSessionNameChanged": IWireDebugSessionName;
        /** Upstream `$acceptDebugSessionCustomEvent`: from the session's start, before it answered `launch`. */
        readonly "debug.acceptSessionCustomEvent": IWireDebugSessionCustomEvent;
        /** Upstream `$acceptBreakpointsDelta`: every breakpoint at attach, then each change but session-only ones. */
        readonly "debug.acceptBreakpointsDelta": IWireDebugBreakpointsDelta;
        /** Upstream `$acceptStackFrameFocus`. */
        readonly "debug.acceptStackFocus": IWireDebugStackFocus;

        readonly "treeView.setVisible": IWireTreeViewVisibility;
        readonly "treeView.setExpanded": IWireTreeViewExpansion;
        readonly "treeView.setSelection": IWireTreeViewSelection;

        /** Upstream `$cancelExtensionTestRun`: the run's token; a second cancel ends its `TestRun`s at once. */
        readonly "testing.cancelExtensionTestRun": IWireCancelTestRun;
    };
}

export interface ISubprocessToHost {
    readonly requests: {
        readonly "workspace.applyEdit": readonly [IWireApplyWorkspaceEditParams, boolean];
        /** Responds AFTER `editor.didOpen` of the new document: after `await` it is already in the registry. */
        readonly "workspace.createUntitledDocument": readonly [IWireCreateUntitledParams, IWireUriParams];
        /**
         * Upstream `$tryOpenDocument`. Responds AFTER `editor.didOpen` (and, with an encoding, after the reread);
         * `null` means no live document: not a readable file (the subprocess reports it from its own read) or above
         * the sync limit. With an encoding, a dirty document rejects.
         */
        readonly "workspace.openTextDocument": readonly [IWireOpenTextDocumentParams, IWireUriParams | null];
        /** `true`: everything was saved. */
        readonly "workspace.saveAll": readonly [IWireSaveAllParams, boolean];
        /** Without Save As. */
        readonly "workspace.save": readonly [IWireUriParams, IWireSaveResult];

        readonly "editor.setOptions": readonly [IWireSetEditorOptionsParams, null];
        readonly "editor.applyEdit": readonly [IWireApplyEditParams, boolean];
        /** `false`: another version, a read-only or closed editor, overlapping ranges; nothing changed then. */
        readonly "editor.insertSnippet": readonly [IWireInsertSnippetParams, boolean];
        readonly "editor.showTextDocument": readonly [IWireShowTextDocumentParams, IWireShowTextDocumentResult];
        readonly "editor.closeTabs": readonly [IWireCloseTabsParams, boolean];
        readonly "editor.closeGroups": readonly [IWireCloseGroupsParams, boolean];

        readonly "commands.executeCommand": readonly [IWireExecuteCommandParams, unknown];
        /** Upstream `$getCommands`: everything in the core registry, internal ones too. */
        readonly "commands.getCommands": readonly [undefined, readonly string[]];

        readonly "languages.getLanguages": readonly [undefined, readonly string[]];
        /** A document without a model has its language asked for, as upstream's `createByFilepathOrFirstLine`. */
        readonly "languages.getLanguageOfDocument": readonly [IWireUriParams, IWireDocumentLanguage];
        /** Responds AFTER `editor.didClose`/`editor.didOpen` of a document the core holds. */
        readonly "languages.changeLanguage": readonly [IWireChangeLanguageParams, IWireChangeLanguageResult];

        readonly "window.showInputBox": readonly [IWireInputBoxRequest, IWireInputBoxResult];
        readonly "window.showQuickPick": readonly [IWireQuickPickRequest, IWireQuickPickResult];
        readonly "window.showOpenDialog": readonly [IWireOpenDialogRequest, IWireOpenDialogResult];
        readonly "window.showSaveDialog": readonly [IWireSaveDialogRequest, IWireSaveDialogResult];
        readonly "window.showMessage": readonly [IWireShowMessageRequest, IWireShowMessageResult];

        readonly "env.clipboard.readText": readonly [undefined, IWireClipboardText];
        readonly "env.clipboard.writeText": readonly [IWireClipboardText, null];
        readonly "env.openExternal": readonly [IWireUriParams, IWireOpenExternalResult];

        readonly "secrets.keys": readonly [IWireSecretKeysRequest, IWireSecretKeys];
        readonly "secrets.get": readonly [IWireSecretRef, IWireSecretValue];
        readonly "secrets.store": readonly [IWireSecretWrite, null];
        readonly "secrets.delete": readonly [IWireSecretRef, null];

        readonly "memento.update": readonly [IWireMementoUpdate, null];

        /** Responds after the write; the new value arrives before it via `workspace.configurationChanged`. */
        readonly "configuration.update": readonly [IWireConfigurationUpdate, null];

        readonly "tasks.fetch": readonly [IWireTaskFilter, IWireTask[]];
        /** Responds when the task has started, not when it has finished. */
        readonly "tasks.execute": readonly [WireTaskExecuteRequest, IWireTaskExecution];

        /** Upstream `$startDebugging`: whether the session (or every session of a compound) started. */
        readonly "debug.startDebugging": readonly [IWireDebugStartDebugging, boolean];
        /** Upstream `$stopDebugging`; rejects for an unknown session. */
        readonly "debug.stopDebugging": readonly [IWireDebugStopDebugging, null];
        /** Upstream `$customDebugAdapterRequest`: the response's body; rejects for an unknown session or a failure. */
        readonly "debug.customRequest": readonly [IWireDebugCustomRequest, IWireDebugCustomResponse];
        /** Upstream `$getDebugProtocolBreakpoint`; rejects for an unknown session. */
        readonly "debug.getDebugProtocolBreakpoint": readonly [
            IWireDebugProtocolBreakpointRequest,
            IWireDebugProtocolBreakpoint,
        ];
        /** Upstream `$registerBreakpoints`: responds once the breakpoints are in the model. */
        readonly "debug.registerBreakpoints": readonly [IWireDebugRegisterBreakpoints, null];
        readonly "debug.unregisterBreakpoints": readonly [IWireDebugUnregisterBreakpoints, null];

        /** Responds once the tree has reread: `reveal` waits for a refresh in flight, as upstream. */
        readonly "treeView.refresh": readonly [IWireTreeViewRefresh, null];
        readonly "treeView.reveal": readonly [IWireTreeViewReveal, null];
    };
    readonly notifications: {
        readonly "languages.register": IWireLanguageProviderRegistration;
        readonly "languages.registerWorkspaceSymbol": IWireWorkspaceSymbolProviderRegistration;
        readonly "languages.unregister": IWireLanguageProviderUnregistration;
        readonly "languages.didChangeSemanticTokens": IWireProviderHandle;
        readonly "languages.didChangeInlayHints": IWireProviderHandle;
        readonly "languages.didChangeCodeLenses": IWireProviderHandle;
        /** Removed by the same `handle`. */
        readonly "languages.setLanguageConfiguration": IWireLanguageConfiguration;
        readonly "languages.unsetLanguageConfiguration": IWireProviderHandle;
        readonly "languages.statusItem.update": IWireLanguageStatusItem;
        readonly "languages.statusItem.dispose": IWireProviderHandle;

        readonly "workspace.fileSystemProvidersChanged": IWireFileSystemSchemes;
        readonly "workspace.fs.didChangeFile": IWireChangedFiles;
        readonly "workspace.textDocumentContentProvidersChanged": IWireSchemes;
        readonly "workspace.textDocumentContentChanged": IWireUriParams;
        readonly "workspace.watcher.create": IWireWatcherCreate;
        readonly "workspace.watcher.dispose": IWireWatcherDispose;
        readonly "workspace.updateSubscriptions": IWireSubscriptions;
        /** Without "will" listeners the host doesn't wait for the subprocess before a file operation. */
        readonly "workspace.updateFileOperationSubscriptions": IWireFileOperationSubscriptions;
        readonly "workspace.updateWorkspaceFolders": IWireUpdateWorkspaceFolders;

        readonly "editor.setSelection": IWireSetSelectionParams;
        readonly "editor.setDecorations": IWireSetDecorations;
        readonly "editor.revealRange": IWireRevealRange;

        readonly "diagnostics.publish": IWireDiagnosticsPublish;

        readonly "commands.registerCommand": IWireRegisterCommandParams;
        readonly "commands.unregisterCommand": IWireCommandId;

        readonly "window.progress.start": IWireProgressStart;
        readonly "window.progress.report": IWireProgressReport;
        readonly "window.progress.end": IWireProgressEnd;
        readonly "window.statusBarItem.update": IWireStatusBarItem;
        readonly "window.statusBarItem.dispose": IWireStatusBarItemDispose;
        readonly "window.createTextEditorDecorationType": IWireCreateDecorationType;
        readonly "window.disposeTextEditorDecorationType": IWireDisposeDecorationType;
        /** Upstream `$registerDecorationProvider`: sent for every provider, with or without a change event. */
        readonly "window.registerFileDecorationProvider": IWireFileDecorationProvider;
        readonly "window.unregisterFileDecorationProvider": IWireFileDecorationProviderHandle;
        readonly "window.fileDecorationsChanged": IWireFileDecorationsChanged;
        readonly "window.quickInput.cancel": IWireQuickInputCancel;
        readonly "window.showQuickPick.items": IWireQuickPickItems;
        readonly "window.quickPick.update": IWireQuickPickUpdate;
        readonly "window.quickPick.dispose": IWireQuickPickDispose;
        readonly "window.registerUriHandler": IWireUriHandlerRegistration;
        readonly "window.unregisterUriHandler": IWireUriHandlerRegistration;

        readonly "output.append": IWireOutputAppend;
        readonly "output.show": IWireOutputShow;

        readonly "terminal.setEnvironmentVariableCollection": IWireSetEnvironmentVariableCollection;
        readonly "terminal.create": IWireTerminalCreate;
        readonly "terminal.show": IWireTerminalShow;
        readonly "terminal.hide": IWireTerminalTarget;
        readonly "terminal.sendText": IWireTerminalSendText;
        readonly "terminal.dispose": IWireTerminalTarget;
        readonly "terminal.pty.data": IWireTerminalPtyData;
        readonly "terminal.pty.exit": IWireTerminalPtyExit;
        readonly "terminal.pty.name": IWireTerminalPtyName;
        readonly "terminal.shellIntegration.executeCommand": IWireTerminalExecuteCommand;
        readonly "terminal.registerProfileProvider": IWireTerminalProfileProvider;
        readonly "terminal.unregisterProfileProvider": IWireTerminalProfileProvider;

        readonly "tasks.registerProvider": IWireTaskProviderRegistration;
        readonly "tasks.unregisterProvider": IWireTaskProviderHandle;
        readonly "tasks.terminate": IWireTaskExecutionId;

        readonly "debug.registerConfigurationProvider": IWireDebugConfigurationProvider;
        readonly "debug.unregisterConfigurationProvider": IWireDebugProviderHandle;
        /** Sent with every extension catalog; replaces the previous types. */
        readonly "debug.registerDebugTypes": IWireDebugTypes;
        /** Upstream `$acceptDAMessage`: adapter → core. */
        readonly "debug.acceptAdapterMessage": IWireDebugAdapterMessage;
        readonly "debug.acceptAdapterError": IWireDebugAdapterError;
        readonly "debug.acceptAdapterExit": IWireDebugAdapterExit;
        /** Upstream `$setDebugSessionName`: an unknown session is no error. */
        readonly "debug.setSessionName": IWireDebugSetSessionName;
        /** Upstream `$appendDebugConsole`: into the focused session's Debug Console, as a warning. */
        readonly "debug.appendDebugConsole": IWireDebugConsoleAppend;

        readonly "treeView.register": IWireTreeViewRegistration;
        readonly "treeView.dispose": IWireTreeViewId;
        readonly "treeView.setMessage": IWireTreeViewMessage;
        readonly "treeView.setTitle": IWireTreeViewTitle;

        readonly "testing.registerController": IWireTestController;
        readonly "testing.updateController": IWireTestControllerPatch;
        readonly "testing.unregisterController": IWireTestControllerId;
        readonly "testing.publishDiff": IWireTestsDiff;
        readonly "testing.publishProfile": IWireTestRunProfile;
        readonly "testing.updateProfile": IWireTestRunProfileUpdate;
        readonly "testing.removeProfile": IWireTestRunProfileId;
        readonly "testing.startedExtensionTestRun": IWireExtensionTestRun;
        readonly "testing.finishedExtensionTestRun": IWireTestRunId;
        readonly "testing.startedTestRunTask": IWireTestRunTask;
        readonly "testing.finishedTestRunTask": IWireTestRunTaskId;
        readonly "testing.addTestsToRun": IWireAddTestsToRun;
        readonly "testing.updateTestStateInRun": IWireTestStateInRun;
        readonly "testing.appendTestMessagesInRun": IWireTestMessagesInRun;
        readonly "testing.appendOutputToRun": IWireTestOutputInRun;

        /** The index under the key grew or its walk ended; debounced. */
        readonly "search.fileIndexChanged": IWireFileSearchCacheKey;

        /** `host.activateExtension` may be sent. */
        readonly "host.ready": null;
    };
}

export interface IWireFileSearchCacheKey {
    readonly cacheKey: string;
}

export type HostRpc = RpcEndpoint<IHostToSubprocess, ISubprocessToHost>;

export type SubprocessRpc = RpcEndpoint<ISubprocessToHost, IHostToSubprocess>;
