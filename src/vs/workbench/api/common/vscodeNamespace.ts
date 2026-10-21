import { randomUUID } from "node:crypto";

import type * as vscode from "vscode";

import { UI_LOCALE } from "../../../platform/environment/common/uiLocale.ts";

import { createApiCommands } from "./apiCommands.ts";
import { implementsApi } from "./apiSurface.ts";
import { createAuthenticationNoop } from "./authenticationNoop.ts";
import { buildCommandsNamespace } from "./commandsNamespace.ts";
import { createCommentsNoop } from "./commentsNoop.ts";
import { createDebugNoop } from "./debugNoop.ts";
import {
    Breakpoint,
    DebugAdapterExecutable,
    DebugAdapterInlineImplementation,
    DebugAdapterNamedPipeServer,
    DebugAdapterServer,
    DebugConfigurationProviderTriggerKind,
    DebugConsoleMode,
    DebugStackFrame,
    DebugThread,
    FunctionBreakpoint,
    SourceBreakpoint,
} from "./debugTypes.ts";
import { ExtHostEnvironmentVariableCollections } from "./environmentVariableCollection.ts";
import { createExtensionSecretsFactory, type IExtensionSecretsFactory } from "./extensionSecrets.ts";
import { createExtensionsNamespace } from "./extensionsNamespace.ts";
import type { IExtHostDisk } from "./extHostDisk.ts";
import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import { createL10nNamespace } from "./l10nNamespace.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { createTasksNamespace } from "./tasksNamespace.ts";
import { createTelemetryLogger } from "./telemetryLogger.ts";
import { createTerminalNamespace } from "./terminalNamespace.ts";
import {
    BranchCoverage,
    DeclarationCoverage,
    FileCoverage,
    StatementCoverage,
    TestCoverageCount,
    TestMessage,
    TestMessageStackFrame,
    TestRunProfileKind,
    TestRunRequest,
    TestTag,
} from "./testingTypes.ts";
import { createTestsNoop } from "./testsNoop.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { VSCODE_SHIM_VERSION } from "./vscodeShimVersion.ts";
import {
    CallHierarchyItem,
    CancellationError,
    CancellationTokenSource,
    CodeAction,
    CodeActionKind,
    CodeActionTriggerKind,
    CodeLens,
    ColorThemeKind,
    CommentMode,
    CommentThreadCollapsibleState,
    CommentThreadState,
    CompletionItem,
    CompletionItemKind,
    CompletionItemTag,
    CompletionList,
    CompletionTriggerKind,
    ConfigurationTarget,
    CustomExecution,
    DecorationRangeBehavior,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
    DisposableImpl,
    DocumentHighlightKind,
    DocumentLink,
    DocumentSymbol,
    EndOfLine,
    EnvironmentVariableMutatorType,
    EventEmitter,
    ExtensionKind,
    ExtensionMode,
    FileChangeType,
    FileDecoration,
    FileSystemError,
    FileType,
    FoldingRange,
    FoldingRangeKind,
    Hover,
    IndentAction,
    InlayHint,
    InlineCompletionItem,
    InlineCompletionList,
    InlineCompletionTriggerKind,
    InputBoxValidationSeverity,
    LanguageStatusSeverity,
    Location,
    LogLevel,
    MarkdownString,
    NotebookCellKind,
    NotebookCellOutputItem,
    OverviewRulerLane,
    ParameterInformation,
    Position,
    ProcessExecution,
    ProgressLocation,
    QuickPickItemKind,
    Range,
    RelativePattern,
    Selection,
    SelectionRange,
    SemanticTokens,
    SemanticTokensBuilder,
    SemanticTokensEdit,
    SemanticTokensEdits,
    SemanticTokensLegend,
    ShellExecution,
    ShellQuoting,
    SignatureHelp,
    SignatureHelpTriggerKind,
    SignatureInformation,
    SnippetString,
    SnippetTextEdit,
    StatusBarAlignment,
    SymbolInformation,
    SymbolKind,
    SymbolTag,
    SyntaxTokenType,
    TabInputCustom,
    TabInputNotebook,
    TabInputNotebookDiff,
    TabInputTerminal,
    TabInputText,
    TabInputTextDiff,
    TabInputWebview,
    Task,
    TaskGroup,
    TaskPanelKind,
    TaskRevealKind,
    TaskScope,
    TelemetryTrustedValue,
    TerminalExitReason,
    TerminalLocation,
    TerminalShellExecutionCommandLineConfidence,
    TextDocumentChangeReason,
    TextDocumentSaveReason,
    TextEdit,
    TextEditorSelectionChangeKind,
    ThemeColor,
    ThemeIcon,
    TreeItem,
    TreeItemCheckboxState,
    TreeItemCollapsibleState,
    TypeHierarchyItem,
    UIKind,
    Uri,
    ViewColumn,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import {
    type IWireEnvInitialize,
    type IWireExtensionDescription,
    parseWireClipboardText,
    parseWireEnvInitialize,
    parseWireOpenExternalResult,
} from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

export interface IVscodeHost {
    readonly namespace: typeof vscode;
    readonly configStore: WorkspaceConfigStore;
    /** Наполняет точка входа субпроцесса — только она видит результат `activate()`. */
    readonly extensionExports: Map<string, unknown>;
    readonly secrets: IExtensionSecretsFactory;
    readonly environmentVariableCollections: ExtHostEnvironmentVariableCollections;
    /** Выставляет оверлей расширения (`extensionApiFactory.ts`). */
    readonly owner: ExtensionOwner;
    readonly onDidReceiveCatalog: vscode.Event<readonly IWireExtensionDescription[]>;
}

/** Мутирующие действия уходят хосту RPC-запросами: прямой ссылки на host-сервисы у шима нет. */
export function buildVscodeNamespace(rpc: SubprocessRpc, disk: IExtHostDisk): IVscodeHost {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk,
        owner: new ExtensionOwner(),
    };

    // Терминалы общие у `window` и `tasks`: pty `CustomExecution` подключается к терминалу задачи.
    const terminals = createTerminalNamespace(rpc);
    const window = createWindowNamespace(ctx, terminals);
    // Отложенный вызов: `tasks` ещё не собран (ему нужны папки `workspace`).
    const workspace = createWorkspaceNamespace(ctx, (type, provider) => tasks.registerTaskProvider(type, provider));
    // Собирается ДО languages: applyCodeAction исполняет команды действий.
    const apiCommands = createApiCommands({
        showTextDocument: (uri, options) => window.showTextDocument(uri, options),
        openExternal: (target) => env.openExternal(target),
    });
    const commands = buildCommandsNamespace(rpc, () => window.activeTextEditor, ctx.owner, apiCommands);
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: (edit, metadata) => workspace.applyEdit(edit, metadata),
        executeCommand: (command, ...args) => commands.executeCommand(command, ...args),
    });

    // Семя `env.initialize` приходит до первой активации; профилей терминала нет — `onDidChangeShell` не стреляет.
    let hostEnvironment: IWireEnvInitialize = { machineId: "", shell: "" };
    rpc.handleNotification("env.initialize", (params) => {
        hostEnvironment = parseWireEnvInitialize(params);
    });

    const env = {
        get machineId(): string {
            return hostEnvironment.machineId;
        },
        get shell(): string {
            return hostEnvironment.shell;
        },
        onDidChangeShell: new EventEmitter<string>().event,
        appName: "Diode",
        appHost: "desktop",
        language: UI_LOCALE,
        uriScheme: "diode",
        clipboard: {
            readText: async (): Promise<string> =>
                parseWireClipboardText(await rpc.request("env.clipboard.readText")).text,
            writeText: async (value: string): Promise<void> => {
                await rpc.request("env.clipboard.writeText", { text: value });
            },
        },
        /** `true` и без графического окружения: хост показал URL сообщением и положил в буфер обмена. */
        openExternal: async (target: vscode.Uri): Promise<boolean> =>
            parseWireOpenExternalResult(
                // skipEncoding, как в эталоне: обычный `toString()` отдал бы системе `?token%3D42` вместо `?token=42`.
                await rpc.request("env.openExternal", { uri: target.toString(true) }),
            ),

        /** Отступление от эталона: id не переживает перезапуск extension host'а. `redhat.java` отличает по нему свой запуск от чужого. */
        sessionId: randomUUID(),

        isTelemetryEnabled: false,
        onDidChangeTelemetryEnabled: new EventEmitter<boolean>().event,
        createTelemetryLogger,

        remoteName: undefined,

        // `Web` в контракте — доступ из браузера (vscode.dev), а не «не-графический UI».
        uiKind: UIKind.Desktop,
    };

    const { extensions, exportsById, onDidReceiveCatalog } = createExtensionsNamespace(rpc);
    const secrets = createExtensionSecretsFactory(rpc);
    const environmentVariableCollections = new ExtHostEnvironmentVariableCollections(rpc);

    const tasks = createTasksNamespace({
        rpc,
        owner: ctx.owner,
        workspaceFolders: () => workspace.workspaceFolders,
        attachPty: (terminalId, pty) => {
            terminals.attachPty(terminalId, pty);
        },
        onDidReceiveCatalog,
    });

    const namespace = {
        // vscode-languageclient требует валидный semver (^1.91.0); лок-степ с extensions/VSCODE_VERSION.
        version: VSCODE_SHIM_VERSION,
        Disposable: DisposableImpl,
        Position,
        Range,
        Selection,
        SelectionRange,
        TextEdit,
        Uri,
        RelativePattern,
        EventEmitter,
        CompletionItem,
        CompletionList,
        CompletionTriggerKind,
        // Каст и здесь, и у трёх классов ниже, что держат SnippetString в полях: у нашего
        // SnippetString только `appendText` без экранирования, билдеров из d.ts нет.
        SnippetString: SnippetString as unknown as typeof vscode.SnippetString,
        InlineCompletionItem: InlineCompletionItem as unknown as typeof vscode.InlineCompletionItem,
        InlineCompletionList: InlineCompletionList as unknown as typeof vscode.InlineCompletionList,
        InlineCompletionTriggerKind,
        EndOfLine,
        TextDocumentSaveReason,
        TextDocumentChangeReason,
        ConfigurationTarget,
        FileChangeType,
        FileType,
        FileSystemError,
        CompletionItemKind,
        FoldingRange,
        FoldingRangeKind,
        SemanticTokens,
        SemanticTokensBuilder,
        SemanticTokensEdit,
        SemanticTokensEdits,
        SemanticTokensLegend,
        Location,
        Diagnostic,
        DiagnosticRelatedInformation,
        DiagnosticSeverity,
        DiagnosticTag,
        InputBoxValidationSeverity,
        CodeLens,
        CodeAction,
        CodeActionKind,
        CodeActionTriggerKind,
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
        ExtensionMode,
        ExtensionKind,
        LogLevel,
        ProgressLocation,
        MarkdownString,
        Hover,
        SignatureHelp,
        SignatureInformation,
        ParameterInformation,
        SignatureHelpTriggerKind,
        WorkspaceEdit,
        SnippetTextEdit: SnippetTextEdit as unknown as typeof vscode.SnippetTextEdit,
        StatusBarAlignment,
        TerminalExitReason,
        TerminalLocation,
        TerminalShellExecutionCommandLineConfidence,
        EnvironmentVariableMutatorType,
        UIKind,
        ColorThemeKind,
        TextEditorSelectionChangeKind,
        ThemeColor,
        FileDecoration,
        OverviewRulerLane,
        DecorationRangeBehavior,
        ViewColumn,
        // Все семь TabInput*, даже непроизводимые: instanceof-каскад расширений требует каждого.
        TabInputText,
        TabInputTextDiff,
        TabInputCustom,
        TabInputWebview,
        TabInputNotebook,
        TabInputNotebookDiff,
        TabInputTerminal,
        LanguageStatusSeverity,
        window,
        workspace,
        languages,
        commands,
        env: implementsApi<typeof vscode.env>()(env),
        extensions,
        l10n: createL10nNamespace(),
        tasks: implementsApi<typeof vscode.tasks>()(tasks),
        Task,
        TaskScope,
        TaskGroup,
        TaskRevealKind,
        TaskPanelKind,
        ShellExecution,
        ShellQuoting,
        ProcessExecution,
        CustomExecution,
        TreeItem,
        TreeItemCollapsibleState,
        TreeItemCheckboxState,
        ThemeIcon,
        TelemetryTrustedValue,
        // Notebook'ов нет, но Claude Code строит `NotebookCellOutputItem.error(...)` при загрузке модуля.
        NotebookCellOutputItem,
        authentication: createAuthenticationNoop(rpc),
        comments: createCommentsNoop(rpc),
        CommentThreadCollapsibleState,
        CommentMode,
        CommentThreadState,
        // Дебаггера нет (решение человека), но без namespace'а `golang.go` обрывал `activate()`.
        debug: createDebugNoop(rpc),
        DebugAdapterExecutable,
        DebugAdapterServer,
        DebugAdapterNamedPipeServer,
        DebugAdapterInlineImplementation,
        DebugConsoleMode,
        DebugConfigurationProviderTriggerKind,
        DebugThread,
        DebugStackFrame,
        Breakpoint,
        SourceBreakpoint,
        FunctionBreakpoint,
        tests: createTestsNoop(rpc),
        TestRunProfileKind,
        TestTag,
        TestRunRequest,
        TestMessage,
        TestMessageStackFrame,
        TestCoverageCount,
        FileCoverage,
        StatementCoverage,
        BranchCoverage,
        DeclarationCoverage,
        DocumentSymbol,
        QuickPickItemKind,
        NotebookCellKind,
        IndentAction,
        SyntaxTokenType,
    };

    return {
        namespace: implementsApi<typeof vscode>()(namespace),
        configStore: ctx.configStore,
        extensionExports: exportsById,
        secrets,
        environmentVariableCollections,
        owner: ctx.owner,
        onDidReceiveCatalog,
    };
}
