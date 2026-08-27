import type * as vscode from "vscode";

import { buildCommandsNamespace } from "./commandsNamespace.ts";
import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import type { RpcEndpoint } from "./rpcEndpoint.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    CallHierarchyItem,
    CancellationError,
    CancellationTokenSource,
    CodeAction,
    CodeActionKind,
    CodeLens,
    CompletionItem,
    CompletionItemKind,
    CompletionItemTag,
    CompletionList,
    CompletionTriggerKind,
    DecorationRangeBehavior,
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticTag,
    DisposableImpl,
    DocumentHighlightKind,
    DocumentLink,
    EndOfLine,
    EventEmitter,
    FileChangeType,
    FileDecoration,
    FileSystemError,
    FileType,
    FoldingRange,
    FoldingRangeKind,
    Hover,
    InlayHint,
    Location,
    LogLevel,
    MarkdownString,
    OverviewRulerLane,
    Position,
    ProgressLocation,
    Range,
    RelativePattern,
    Selection,
    SnippetString,
    SymbolInformation,
    SymbolKind,
    SymbolTag,
    TabInputCustom,
    TabInputNotebook,
    TabInputNotebookDiff,
    TabInputTerminal,
    TabInputText,
    TabInputTextDiff,
    TabInputWebview,
    TextDocumentSaveReason,
    TextEdit,
    ThemeColor,
    TypeHierarchyItem,
    Uri,
    ViewColumn,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import { VSCODE_SHIM_VERSION } from "./vscodeShimVersion.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

/**
 * Результат сборки шима: сам объект `vscode` (раздаётся расширениям через
 * `Module._cache`) и {@link WorkspaceConfigStore}, в который subprocess-entry
 * кладёт `configDefaults` расширения ДО `activate()`.
 */
export interface IVscodeHost {
    readonly namespace: typeof vscode;
    readonly configStore: WorkspaceConfigStore;
}

/**
 * Собирает объект `vscode`, раздаваемый расширениям (in-process в тестах или в
 * subprocess через `Module._cache`).
 *
 * Ассемблер держит общее состояние ({@link IVscodeHostContext}: реестр документов
 * со стабильной идентичностью и хранилище конфигурации) и композирует поверх него
 * namespace'ы `window` / `workspace` / `languages` / `commands`. Value-типы
 * (`Position`, `Range`, `TextEdit`, `Uri`, enum'ы, `EventEmitter`) отдаются как
 * runtime-поля — расширение делает `new vscode.Position(...)` и т.п.
 *
 * Все мутирующие действия проксируются хосту как RPC-запросы; прямой ссылки на
 * host-сервисы у `vscode`-неймспейса нет.
 */
export function buildVscodeNamespace(rpc: RpcEndpoint): IVscodeHost {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };

    const window = createWindowNamespace(ctx);
    const workspace = createWorkspaceNamespace(ctx);
    const { languages } = createLanguagesNamespace(ctx);
    // WP4: commands bridge поверх симметричного rpc (локальная Map команд +
    // прокси в host CommandRegistry).
    const commands = buildCommandsNamespace(rpc);

    // Наивный `env` — vscode-languageclient читает language/appName; клипборд и
    // openExternal честно отказывают (TUI не открывает внешние URL).
    const env = {
        appName: "Diode",
        appHost: "desktop",
        language: "en",
        uriScheme: "diode",
        clipboard: {
            readText: (): Thenable<string> => Promise.resolve(""),
            writeText: (): Thenable<void> => Promise.resolve(),
        },
        openExternal: (): Thenable<boolean> => Promise.resolve(false),
    } as unknown;

    const namespace = {
        // vscode-languageclient требует валидный VS Code semver (^1.91.0).
        // Лок-степ с extensions/VSCODE_VERSION — проверяет vscodeNamespace.identity.test.
        version: VSCODE_SHIM_VERSION,
        Disposable: DisposableImpl,
        // Value-типы — обязательно перечислить поимённо: каст `as unknown as
        // typeof vscode` прячет пропуск, он всплыл бы только рантайм-undefined
        // внутри расширения (`new vscode.Position(...)`).
        Position,
        Range,
        Selection,
        TextEdit,
        Uri,
        // База для createFileSystemWatcher: встроенный git строит им и watcher
        // рабочего дерева, и дешёвый нерекурсивный watcher `.git`.
        RelativePattern,
        EventEmitter,
        CompletionItem,
        // CompletionList/SnippetString конструирует сам languageclient на каждом
        // ответе сервера — без них конвертация completion падала молча.
        CompletionList,
        CompletionTriggerKind,
        SnippetString,
        EndOfLine,
        TextDocumentSaveReason,
        FileChangeType,
        FileType,
        FileSystemError,
        CompletionItemKind,
        FoldingRange,
        FoldingRangeKind,
        Location,
        Diagnostic,
        DiagnosticSeverity,
        DiagnosticTag,
        CodeLens,
        CodeAction,
        CodeActionKind,
        DocumentLink,
        DocumentHighlightKind,
        InlayHint,
        SymbolInformation,
        SymbolKind,
        SymbolTag,
        CompletionItemTag,
        CallHierarchyItem,
        TypeHierarchyItem,
        CancellationError,
        CancellationTokenSource,
        LogLevel,
        ProgressLocation,
        MarkdownString,
        Hover,
        WorkspaceEdit,
        ThemeColor,
        FileDecoration,
        OverviewRulerLane,
        DecorationRangeBehavior,
        ViewColumn,
        // Все семь TabInput* — см. комментарий у классов: instanceof-каскад
        // расширений требует существования каждого, даже непроизводимых.
        TabInputText,
        TabInputTextDiff,
        TabInputCustom,
        TabInputWebview,
        TabInputNotebook,
        TabInputNotebookDiff,
        TabInputTerminal,
        window,
        workspace,
        languages,
        commands,
        env,
    } as unknown as typeof vscode;

    return { namespace, configStore: ctx.configStore };
}
