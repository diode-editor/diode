import type { ICoreSignatureHelp } from "../../../editor/common/languages/iSignatureHelpSource.ts";

import type { IActiveEditorMeta, IActiveEditorSelections, IEditorOptionsState } from "./iEditorOptionsService.ts";
import type { IRpcProtocol, IUntypedProtocol, RpcEndpoint } from "./rpcEndpoint.ts";
import type {
    IWireApplyEditParams,
    IWireApplyWorkspaceEditParams,
    IWireChangedFiles,
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCodeActionParams,
    IWireCompletionParams,
    IWireConfigurationChanged,
    IWireDefinitionParams,
    IWireDiagnosticsPublish,
    IWireDidSaveParams,
    IWireDocumentChangedEvent,
    IWireDocumentSyncSnapshot,
    IWireEditorLayout,
    IWireFoldingParams,
    IWireFormattingParams,
    IWireHoverParams,
    IWireInlineCompletionParams,
    IWireLanguageProviderRegistration,
    IWireLanguageProviderUnregistration,
    IWirePrepareRenameParams,
    IWireReadFileResult,
    IWireReferenceParams,
    IWireRenameParams,
    IWireSchemes,
    IWireSetDecorations,
    IWireSetEditorOptionsParams,
    IWireSetSelectionParams,
    IWireShowTextDocumentParams,
    IWireShowTextDocumentResult,
    IWireSignatureHelpParams,
    IWireSubscriptions,
    IWireTextContentResult,
    IWireUriParams,
    IWireWatcherCreate,
    IWireWatcherDispose,
    IWireWatcherEvents,
    IWireWillSaveParams,
    IWireWorkspaceInitialize,
    WireCodeAction,
    WireCompletionResult,
    WireDefinitionLocation,
    WireFoldingRange,
    WireHover,
    WireInlineCompletionItem,
    WireReference,
    WireRenamePrepare,
    WireRenameResult,
    WireResolvedCompletionItem,
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
 * её локальное сужение доверия, а не контракт. Результат на хосте по-прежнему
 * проходит `parseWire*`.
 *
 * Карта заполняется по группам методов; пока она неполна, у endpoint'ов
 * остальные методы нетипизированы ({@link WithUntyped}).
 */

/** Запросы и нотификации хоста к субпроцессу. */
export interface IHostToSubprocess {
    readonly requests: {
        readonly "languages.provideCompletionItems": readonly [IWireCompletionParams, WireCompletionResult[]];
        readonly "languages.resolveCompletionItem": readonly [
            { readonly id: string },
            WireResolvedCompletionItem | null,
        ];
        readonly "languages.provideInlineCompletions": readonly [
            IWireInlineCompletionParams,
            WireInlineCompletionItem[][],
        ];
        readonly "languages.provideFoldingRanges": readonly [IWireFoldingParams, WireFoldingRange[][]];
        readonly "languages.provideDefinition": readonly [IWireDefinitionParams, WireDefinitionLocation[]];
        readonly "languages.provideHover": readonly [IWireHoverParams, WireHover | null];
        readonly "languages.provideReferences": readonly [IWireReferenceParams, WireReference[]];
        readonly "languages.provideSignatureHelp": readonly [IWireSignatureHelpParams, ICoreSignatureHelp | null];
        readonly "languages.provideFormattingEdits": readonly [IWireFormattingParams, WireTextEdit[]];
        readonly "languages.provideCodeActions": readonly [IWireCodeActionParams, WireCodeAction[]];
        readonly "languages.applyCodeAction": readonly [{ readonly id: string }, boolean];
        readonly "languages.prepareRename": readonly [IWirePrepareRenameParams, WireRenamePrepare | null];
        readonly "languages.provideRenameEdits": readonly [IWireRenameParams, WireRenameResult];

        readonly "workspace.fs.readFile": readonly [IWireUriParams, IWireReadFileResult];
        readonly "workspace.provideTextDocumentContent": readonly [IWireUriParams, IWireTextContentResult];
        readonly "workspace.willSaveTextDocument": readonly [IWireWillSaveParams, WireTextEdit[]];
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
    };
}

/**
 * Протокол с картой плюс нетипизированный остаток: известные методы проверяются,
 * прочие (ещё не перенесённые в карту группы) — как раньше. Уходит, когда
 * карта станет полной.
 */
export interface WithUntyped<P extends IRpcProtocol> {
    readonly requests: P["requests"] & IUntypedProtocol["requests"];
    readonly notifications: P["notifications"] & IUntypedProtocol["notifications"];
}

/** RPC хоста: шлёт {@link IHostToSubprocess}, принимает {@link ISubprocessToHost}. */
export type HostRpc = RpcEndpoint<WithUntyped<IHostToSubprocess>, WithUntyped<ISubprocessToHost>>;

/** RPC субпроцесса: зеркало {@link HostRpc}. */
export type SubprocessRpc = RpcEndpoint<WithUntyped<ISubprocessToHost>, WithUntyped<IHostToSubprocess>>;
