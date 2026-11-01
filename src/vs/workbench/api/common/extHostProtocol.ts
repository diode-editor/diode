import type { IRange } from "../../../editor/common/core/iRange.ts";
import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { IColorInformation } from "../../../editor/common/languages/iColorSource.ts";
import type {
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation } from "../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreDocumentSymbol } from "../../../editor/common/languages/iDocumentSymbolSource.ts";
import type { ICoreHover } from "../../../editor/common/languages/iHoverSource.ts";
import type { ICoreInlineCompletionItem } from "../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ICoreReference } from "../../../editor/common/languages/iReferenceSource.ts";
import type { ICoreSignatureHelp } from "../../../editor/common/languages/iSignatureHelpSource.ts";

import type { IActiveEditorMeta, IActiveEditorSelections, IEditorOptionsState } from "./iEditorOptionsService.ts";
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
    IWireChangedFiles,
    IWireChangeLanguageParams,
    IWireChangeLanguageResult,
    IWireClipboardText,
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCodeActionParams,
    IWireColorTheme,
    IWireCommandId,
    IWireCompletionParams,
    IWireConfigurationChanged,
    IWireConfigurationUpdate,
    IWireCreateDecorationType,
    IWireCreateUntitledParams,
    IWireDefinitionParams,
    IWireDiagnosticsPublish,
    IWireDidSaveParams,
    IWireDisposeDecorationType,
    IWireDocumentChangedEvent,
    IWireDocumentColorParams,
    IWireDocumentLanguage,
    IWireDocumentSemanticTokensParams,
    IWireDocumentStateChanged,
    IWireDocumentSymbolParams,
    IWireDocumentSyncSnapshot,
    IWireEditorLayout,
    IWireEnvInitialize,
    IWireEnvironmentVariableCollections,
    IWireExecuteCommandParams,
    IWireExtensionCatalog,
    IWireExtensionId,
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
    IWireInputBoxRequest,
    IWireInputBoxResult,
    IWireInputBoxValidate,
    IWireLanguageConfiguration,
    IWireLanguageProviderRegistration,
    IWireLanguageProviderUnregistration,
    IWireLanguageStatusItem,
    IWireMarkersChanged,
    IWireMementoUpdate,
    IWireOpenDialogRequest,
    IWireOpenDialogResult,
    IWireOpenExternalResult,
    IWireOutputAppend,
    IWireOutputShow,
    IWirePrepareRenameParams,
    IWireProgressEnd,
    IWireProgressReport,
    IWireProgressStart,
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
    IWireReleaseSemanticTokens,
    IWireRenameParams,
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
    IWireTerminalOpened,
    IWireTerminalPtyData,
    IWireTerminalPtyDimensions,
    IWireTerminalPtyExit,
    IWireTerminalPtyInput,
    IWireTerminalSendText,
    IWireTerminalShow,
    IWireTerminalTarget,
    IWireTextContentResult,
    IWireUpdateWorkspaceFolders,
    IWireUriHandlerRegistration,
    IWireUriParams,
    IWireValidationMessage,
    IWireWatcherCreate,
    IWireWatcherDispose,
    IWireWatcherEvents,
    IWireWillSaveParams,
    IWireWorkspaceEditOp,
    IWireWorkspaceInitialize,
    IWireWriteFileParams,
    WireCodeAction,
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
        readonly "languages.provideCodeActions": readonly [IWireCodeActionParams, WireCodeAction[]];
        readonly "languages.applyCodeAction": readonly [{ readonly id: string; readonly onSave?: boolean }, boolean];
        readonly "languages.prepareRename": readonly [IWirePrepareRenameParams, WireRenamePrepare | null];
        readonly "languages.provideRenameEdits": readonly [IWireRenameParams, WireRenameResult];
        readonly "languages.provideSelectionRanges": readonly [IWireSelectionRangeParams, IRange[][]];
        readonly "languages.provideDocumentColors": readonly [IWireDocumentColorParams, IColorInformation[] | null];
        readonly "languages.provideInlayHints": readonly [IWireInlayHintsParams, IWireInlayHint[] | null];

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
        /** Responds once the handler has finished. */
        readonly "window.handleUri": readonly [IWireHandleUri, null];

        readonly "tasks.provideTasks": readonly [IWireTaskProviderHandle, IWireTask[]];

        /** Upstream `$getChildren`; rejects for a view that is not registered in the subprocess. */
        readonly "treeView.getChildren": readonly [IWireTreeViewGetChildren, IWireTreeItem[]];
        /** Runs the row's `TreeItem.command` there, with its arguments; rejects with the command's error. */
        readonly "treeView.executeCommand": readonly [IWireTreeViewItemRef, null];

        readonly "host.activateExtension": readonly [IWireActivateExtensionParams, null];
        readonly "host.deactivateExtension": readonly [IWireExtensionId, null];
        readonly "host.shutdown": readonly [undefined, null];
    };
    readonly notifications: {
        readonly "languages.releaseDocumentSemanticTokens": IWireReleaseSemanticTokens;
        /** Other owners' MarkerService markers: a mirror for `languages.getDiagnostics`. */
        readonly "diagnostics.markersChanged": IWireMarkersChanged;

        readonly "workspace.initialize": IWireWorkspaceInitialize;
        readonly "env.initialize": IWireEnvInitialize;
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

        readonly "window.themeChanged": IWireColorTheme;
        readonly "window.quickPick.event": IWireQuickPickEvent;
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

        readonly "tasks.didStart": IWireTaskStarted;
        readonly "tasks.didStartProcess": IWireTaskProcessStarted;
        readonly "tasks.didEndProcess": IWireTaskProcessEnded;
        readonly "tasks.didEnd": IWireTaskEnded;

        readonly "treeView.setVisible": IWireTreeViewVisibility;
        readonly "treeView.setExpanded": IWireTreeViewExpansion;
        readonly "treeView.setSelection": IWireTreeViewSelection;
    };
}

export interface ISubprocessToHost {
    readonly requests: {
        readonly "workspace.applyEdit": readonly [IWireApplyWorkspaceEditParams, boolean];
        /** Responds AFTER `editor.didOpen` of the new document: after `await` it is already in the registry. */
        readonly "workspace.createUntitledDocument": readonly [IWireCreateUntitledParams, IWireUriParams];
        /**
         * Upstream `$tryOpenDocument`. Responds AFTER `editor.didOpen`; `null` means no live document: not a
         * readable file (the subprocess reports it from its own read) or above the sync limit.
         */
        readonly "workspace.openTextDocument": readonly [IWireUriParams, IWireUriParams | null];
        /** `true`: everything was saved. */
        readonly "workspace.saveAll": readonly [IWireSaveAllParams, boolean];
        /** Without Save As. */
        readonly "workspace.save": readonly [IWireUriParams, IWireSaveResult];

        readonly "editor.setOptions": readonly [IWireSetEditorOptionsParams, null];
        /** The handler exists but no sender yet: the subprocess reads options from its own proxy. */
        readonly "editor.getOptions": readonly [undefined, IEditorOptionsState | null];
        readonly "editor.applyEdit": readonly [IWireApplyEditParams, boolean];
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

        /** Responds once the tree has reread: `reveal` waits for a refresh in flight, as upstream. */
        readonly "treeView.refresh": readonly [IWireTreeViewRefresh, null];
        readonly "treeView.reveal": readonly [IWireTreeViewReveal, null];
    };
    readonly notifications: {
        readonly "languages.register": IWireLanguageProviderRegistration;
        readonly "languages.unregister": IWireLanguageProviderUnregistration;
        readonly "languages.didChangeSemanticTokens": IWireProviderHandle;
        readonly "languages.didChangeInlayHints": IWireProviderHandle;
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

        readonly "commands.registerCommand": IWireCommandId;
        readonly "commands.unregisterCommand": IWireCommandId;

        readonly "window.progress.start": IWireProgressStart;
        readonly "window.progress.report": IWireProgressReport;
        readonly "window.progress.end": IWireProgressEnd;
        readonly "window.statusBarItem.update": IWireStatusBarItem;
        readonly "window.statusBarItem.dispose": IWireStatusBarItemDispose;
        readonly "window.createTextEditorDecorationType": IWireCreateDecorationType;
        readonly "window.disposeTextEditorDecorationType": IWireDisposeDecorationType;
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

        readonly "tasks.registerProvider": IWireTaskProviderRegistration;
        readonly "tasks.unregisterProvider": IWireTaskProviderHandle;
        readonly "tasks.terminate": IWireTaskExecutionId;

        readonly "treeView.register": IWireTreeViewRegistration;
        readonly "treeView.dispose": IWireTreeViewId;
        readonly "treeView.setMessage": IWireTreeViewMessage;
        readonly "treeView.setTitle": IWireTreeViewTitle;

        /** `host.activateExtension` may be sent. */
        readonly "host.ready": null;
    };
}

export type HostRpc = RpcEndpoint<IHostToSubprocess, ISubprocessToHost>;

export type SubprocessRpc = RpcEndpoint<ISubprocessToHost, IHostToSubprocess>;
