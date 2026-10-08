import type { ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type {
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../editor/common/languages/iCompletionSource.ts";
import type { ICoreDefinitionLocation } from "../../../editor/common/languages/iDefinitionSource.ts";
import type { ICoreHover } from "../../../editor/common/languages/iHoverSource.ts";
import type { ICoreInlineCompletionItem } from "../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ICoreReference } from "../../../editor/common/languages/iReferenceSource.ts";
import type { ICoreSignatureHelp } from "../../../editor/common/languages/iSignatureHelpSource.ts";

import type { IActiveEditorMeta, IActiveEditorSelections, IEditorOptionsState } from "./iEditorOptionsService.ts";
import type { RpcEndpoint } from "./rpcEndpoint.ts";
import type {
    IWireActivateExtensionParams,
    IWireApplyEditParams,
    IWireApplyWorkspaceEditParams,
    IWireChangedFiles,
    IWireClipboardText,
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCodeActionParams,
    IWireColorTheme,
    IWireCommandId,
    IWireCompletionParams,
    IWireConfigurationChanged,
    IWireCreateDecorationType,
    IWireDefinitionParams,
    IWireDiagnosticsPublish,
    IWireDidSaveParams,
    IWireDisposeDecorationType,
    IWireDocumentChangedEvent,
    IWireDocumentSyncSnapshot,
    IWireEditorLayout,
    IWireExecuteCommandParams,
    IWireExtensionCatalog,
    IWireExtensionId,
    IWireFileDecorationsChanged,
    IWireFoldingParams,
    IWireFormattingParams,
    IWireHoverParams,
    IWireInlineCompletionParams,
    IWireInputBoxRequest,
    IWireInputBoxResult,
    IWireInputBoxValidate,
    IWireLanguageProviderRegistration,
    IWireLanguageProviderUnregistration,
    IWireMementoUpdate,
    IWireOpenExternalResult,
    IWireOutputAppend,
    IWireOutputShow,
    IWirePrepareRenameParams,
    IWireProgressEnd,
    IWireProgressReport,
    IWireProgressStart,
    IWireQuickInputCancel,
    IWireQuickPickRequest,
    IWireQuickPickResult,
    IWireReadFileResult,
    IWireReferenceParams,
    IWireRenameParams,
    IWireSchemes,
    IWireSecretKeys,
    IWireSecretKeysRequest,
    IWireSecretRef,
    IWireSecretValue,
    IWireSecretWrite,
    IWireSetDecorations,
    IWireSetEditorOptionsParams,
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
    IWireTerminalSendText,
    IWireTerminalShow,
    IWireTerminalTarget,
    IWireTextContentResult,
    IWireUriParams,
    IWireValidationMessage,
    IWireWatcherCreate,
    IWireWatcherDispose,
    IWireWatcherEvents,
    IWireWillSaveParams,
    IWireWorkspaceInitialize,
    WireCodeAction,
    WireFoldingRange,
    WireRenamePrepare,
    WireRenameResult,
    WireTextEdit,
} from "./wireTypes.ts";

/**
 * Карта протокола extension host'а (upstream — `extHost.protocol.ts`): какие
 * методы шлёт каждая сторона, с какими параметрами и что получает в ответ.
 * Только типы — на проводе ничего не меняется. Направление проверяет
 * компилятор: хост не может послать метод, обработчик которого живёт на
 * хосте, а обработчик субпроцесса обязан вернуть объявленную форму.
 *
 * Параметры — то, что ШЛЁТ отправитель. Принимающая сторона вправе смотреть на
 * них осторожнее (поля необязательны — по проводу едет что прислали), но это
 * её локальное сужение доверия, а не контракт. Ответ языковых запросов
 * (`languages.*`, `workspace.willSaveTextDocument`) хост не перепроверяет:
 * форму гарантирует сериализатор субпроцесса — единственное место утиной
 * проверки объекта расширения. Прочие ответы субпроцесса пока проходят
 * `parseWire*`.
 *
 * Карта описывает все методы провода, кроме служебного `$/cancelRequest`
 * (его ведёт сам `RpcEndpoint`). Метод вне карты не скомпилируется: новый
 * метод провода начинается с записи здесь.
 */

/** Запросы и нотификации хоста к субпроцессу. */
export interface IHostToSubprocess {
    readonly requests: {
        readonly "languages.provideCompletionItems": readonly [IWireCompletionParams, ICoreCompletionResult[]];
        readonly "languages.resolveCompletionItem": readonly [{ readonly id: string }, ICoreResolvedCompletion | null];
        readonly "languages.provideInlineCompletions": readonly [
            IWireInlineCompletionParams,
            ICoreInlineCompletionItem[][],
        ];
        readonly "languages.provideFoldingRanges": readonly [IWireFoldingParams, WireFoldingRange[][]];
        readonly "languages.provideDefinition": readonly [IWireDefinitionParams, ICoreDefinitionLocation[]];
        readonly "languages.provideHover": readonly [IWireHoverParams, ICoreHover | null];
        readonly "languages.provideReferences": readonly [IWireReferenceParams, ICoreReference[]];
        readonly "languages.provideSignatureHelp": readonly [IWireSignatureHelpParams, ICoreSignatureHelp | null];
        readonly "languages.provideFormattingEdits": readonly [IWireFormattingParams, ITextEdit[]];
        readonly "languages.provideCodeActions": readonly [IWireCodeActionParams, WireCodeAction[]];
        readonly "languages.applyCodeAction": readonly [{ readonly id: string }, boolean];
        readonly "languages.prepareRename": readonly [IWirePrepareRenameParams, WireRenamePrepare | null];
        readonly "languages.provideRenameEdits": readonly [IWireRenameParams, WireRenameResult];

        readonly "workspace.fs.readFile": readonly [IWireUriParams, IWireReadFileResult];
        readonly "workspace.provideTextDocumentContent": readonly [IWireUriParams, IWireTextContentResult];
        readonly "workspace.willSaveTextDocument": readonly [IWireWillSaveParams, WireTextEdit[]];

        /** Команда, заведённая расширением: результат — что вернул его колбэк. */
        readonly "commands.executeCommand": readonly [IWireExecuteCommandParams, unknown];

        readonly "window.inputBox.validate": readonly [IWireInputBoxValidate, IWireValidationMessage | null];

        readonly "host.activateExtension": readonly [IWireActivateExtensionParams, null];
        readonly "host.deactivateExtension": readonly [IWireExtensionId, null];
        readonly "host.shutdown": readonly [undefined, null];
    };
    readonly notifications: {
        readonly "workspace.initialize": IWireWorkspaceInitialize;
        readonly "workspace.configurationChanged": IWireConfigurationChanged;
        readonly "workspace.didSaveTextDocument": IWireDidSaveParams;
        readonly "workspace.watcher.events": IWireWatcherEvents;

        readonly "editor.didOpen": IWireDocumentSyncSnapshot;
        /** Правки дельтой либо полный снапшот (flush — замена содержимого целиком). */
        readonly "editor.didChange": IWireDocumentChangedEvent | IWireDocumentSyncSnapshot;
        readonly "editor.didClose": IWireUriParams;
        readonly "editor.activeEditorChanged": IActiveEditorMeta;
        readonly "editor.selectionChanged": IActiveEditorSelections;
        readonly "editor.layoutChanged": IWireEditorLayout;

        readonly "window.themeChanged": IWireColorTheme;

        readonly "secrets.changed": IWireSecretRef;

        readonly "extensions.catalog": IWireExtensionCatalog;
        readonly "extensions.activated": IWireExtensionId;

        readonly "terminal.opened": IWireTerminalOpened;
        readonly "terminal.closed": IWireTerminalClosed;
        readonly "terminal.activeChanged": IWireTerminalActive;
    };
}

/** Запросы и нотификации субпроцесса к хосту. */
export interface ISubprocessToHost {
    readonly requests: {
        readonly "workspace.applyEdit": readonly [IWireApplyWorkspaceEditParams, boolean];

        readonly "editor.setOptions": readonly [IWireSetEditorOptionsParams, null];
        /** Обработчик есть, отправителя пока нет: субпроцесс читает опции из своего прокси. */
        readonly "editor.getOptions": readonly [undefined, IEditorOptionsState | null];
        readonly "editor.applyEdit": readonly [IWireApplyEditParams, boolean];
        readonly "editor.showTextDocument": readonly [IWireShowTextDocumentParams, IWireShowTextDocumentResult];
        readonly "editor.closeTabs": readonly [IWireCloseTabsParams, boolean];
        readonly "editor.closeGroups": readonly [IWireCloseGroupsParams, boolean];

        /** Команда ядра: результат — что вернул её обработчик. */
        readonly "commands.executeCommand": readonly [IWireExecuteCommandParams, unknown];

        readonly "window.showInputBox": readonly [IWireInputBoxRequest, IWireInputBoxResult];
        readonly "window.showQuickPick": readonly [IWireQuickPickRequest, IWireQuickPickResult];
        readonly "window.showMessage": readonly [IWireShowMessageRequest, IWireShowMessageResult];

        readonly "env.clipboard.readText": readonly [undefined, IWireClipboardText];
        readonly "env.clipboard.writeText": readonly [IWireClipboardText, null];
        readonly "env.openExternal": readonly [IWireUriParams, IWireOpenExternalResult];

        readonly "secrets.keys": readonly [IWireSecretKeysRequest, IWireSecretKeys];
        readonly "secrets.get": readonly [IWireSecretRef, IWireSecretValue];
        readonly "secrets.store": readonly [IWireSecretWrite, null];
        readonly "secrets.delete": readonly [IWireSecretRef, null];

        readonly "memento.update": readonly [IWireMementoUpdate, null];
    };
    readonly notifications: {
        readonly "languages.register": IWireLanguageProviderRegistration;
        readonly "languages.unregister": IWireLanguageProviderUnregistration;

        readonly "workspace.fileSystemProvidersChanged": IWireSchemes;
        readonly "workspace.fs.didChangeFile": IWireChangedFiles;
        readonly "workspace.textDocumentContentProvidersChanged": IWireSchemes;
        readonly "workspace.textDocumentContentChanged": IWireUriParams;
        readonly "workspace.watcher.create": IWireWatcherCreate;
        readonly "workspace.watcher.dispose": IWireWatcherDispose;
        readonly "workspace.updateSubscriptions": IWireSubscriptions;

        readonly "editor.setSelection": IWireSetSelectionParams;
        readonly "editor.setDecorations": IWireSetDecorations;

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

        readonly "output.append": IWireOutputAppend;
        readonly "output.show": IWireOutputShow;

        readonly "terminal.create": IWireTerminalCreate;
        readonly "terminal.show": IWireTerminalShow;
        readonly "terminal.hide": IWireTerminalTarget;
        readonly "terminal.sendText": IWireTerminalSendText;
        readonly "terminal.dispose": IWireTerminalTarget;

        /** Сигнал готовности: можно слать `host.activateExtension`. */
        readonly "host.ready": null;
    };
}

/** RPC хоста: шлёт {@link IHostToSubprocess}, принимает {@link ISubprocessToHost}. */
export type HostRpc = RpcEndpoint<IHostToSubprocess, ISubprocessToHost>;

/** RPC субпроцесса: зеркало {@link HostRpc}. */
export type SubprocessRpc = RpcEndpoint<ISubprocessToHost, IHostToSubprocess>;
