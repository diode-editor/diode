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
import { createExtHostTreeViews } from "./extHostTreeViews.ts";
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
    Color,
    ColorInformation,
    ColorPresentation,
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
    TextEditorCursorStyle,
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
import { createWindowNamespace, openBeforeShow } from "./windowNamespace.ts";
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
    /** Filled by the subprocess entry point — only it sees the result of `activate()`. */
    readonly extensionExports: Map<string, unknown>;
    readonly secrets: IExtensionSecretsFactory;
    readonly environmentVariableCollections: ExtHostEnvironmentVariableCollections;
    /** Set by the extension overlay (`extensionApiFactory.ts`). */
    readonly owner: ExtensionOwner;
    readonly onDidReceiveCatalog: vscode.Event<readonly IWireExtensionDescription[]>;
}

/** Mutating actions go to the host as RPC requests: the shim has no direct reference to host services. */
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

    // Terminals are shared by `window` and `tasks`: a `CustomExecution` pty attaches to the task's terminal.
    const terminals = createTerminalNamespace(rpc);
    // Deferred call: a row's command may be the extension's own, and `commands` is built after `window`.
    const treeViews = createExtHostTreeViews(rpc, {
        executeCommand: (id, ...args) => commands.executeCommand(id, ...args),
        owner: ctx.owner,
    });
    // Deferred call: `workspace` is built after `window`.
    const window = createWindowNamespace(ctx, terminals, treeViews, (uri) => workspace.asRelativePath(uri));
    const showWithoutOpening = window.showTextDocument;
    window.showTextDocument = openBeforeShow(showWithoutOpening, (uri) => workspace.openTextDocument(uri));
    // Deferred call: `tasks` is not built yet (it needs the `workspace` folders).
    const workspace = createWorkspaceNamespace(ctx, (type, provider) => tasks.registerTaskProvider(type, provider));
    // Built BEFORE languages: applyCodeAction runs the actions' commands.
    const apiCommands = createApiCommands({
        showTextDocument: (uri, options) => showWithoutOpening(uri, options),
        openExternal: (target) => env.openExternal(target),
    });
    const commands = buildCommandsNamespace(
        rpc,
        () => window.activeTextEditor,
        ctx.owner,
        apiCommands,
        treeViews.processArgument,
    );
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: (edit, metadata) => workspace.applyEdit(edit, metadata),
        executeCommand: (command, ...args) => commands.executeCommand(command, ...args),
    });

    // The `env.initialize` seed arrives before the first activation; there are no terminal profiles, so `onDidChangeShell` never fires.
    let hostEnvironment: IWireEnvInitialize = { machineId: "", shell: "", appRoot: "" };
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
        /** Deviation from upstream: not an install directory (the binary has none) but a cache directory with only VS Code's rg layout. */
        get appRoot(): string {
            return hostEnvironment.appRoot;
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
        /** `true` even without a graphical environment: the host showed the URL in a message and put it on the clipboard. */
        openExternal: async (target: vscode.Uri): Promise<boolean> =>
            parseWireOpenExternalResult(
                // skipEncoding, as upstream: a plain `toString()` would give the system `?token%3D42` instead of `?token=42`.
                await rpc.request("env.openExternal", { uri: target.toString(true) }),
            ),

        /** Deviation from upstream: the id does not survive an extension host restart. `redhat.java` uses it to tell its own launch from another one. */
        sessionId: randomUUID(),

        isTelemetryEnabled: false,
        onDidChangeTelemetryEnabled: new EventEmitter<boolean>().event,
        createTelemetryLogger,

        remoteName: undefined,

        // `Web` in the contract means browser access (vscode.dev), not "non-graphical UI".
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
        // vscode-languageclient requires a valid semver (^1.91.0); lock-step with extensions/VSCODE_VERSION.
        version: VSCODE_SHIM_VERSION,
        Disposable: DisposableImpl,
        Position,
        Range,
        Selection,
        SelectionRange,
        Color,
        ColorInformation,
        ColorPresentation,
        TextEdit,
        Uri,
        RelativePattern,
        EventEmitter,
        CompletionItem,
        CompletionList,
        CompletionTriggerKind,
        // Cast here and in the three classes below that hold SnippetString in fields: our
        // SnippetString has only `appendText` without escaping, no d.ts builders.
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
        TextEditorCursorStyle,
        TextEditorSelectionChangeKind,
        ThemeColor,
        FileDecoration,
        OverviewRulerLane,
        DecorationRangeBehavior,
        ViewColumn,
        // All seven TabInput*, even the ones never produced: extensions' instanceof cascades need each one.
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
        // No notebooks, but Claude Code builds `NotebookCellOutputItem.error(...)` at module load.
        NotebookCellOutputItem,
        authentication: createAuthenticationNoop(rpc),
        comments: createCommentsNoop(rpc),
        CommentThreadCollapsibleState,
        CommentMode,
        CommentThreadState,
        // No debugger (owner's decision), but without the namespace `golang.go` aborted `activate()`.
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
