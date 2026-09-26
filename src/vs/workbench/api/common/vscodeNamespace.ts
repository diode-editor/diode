import type * as vscode from "vscode";

import { buildCommandsNamespace } from "./commandsNamespace.ts";
import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createL10nNamespace } from "./l10nNamespace.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import type { RpcEndpoint } from "./rpcEndpoint.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
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
    CompletionItem,
    CompletionItemKind,
    CompletionItemTag,
    CompletionList,
    CompletionTriggerKind,
    DecorationRangeBehavior,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
    DisposableImpl,
    DocumentHighlightKind,
    DocumentLink,
    EndOfLine,
    EventEmitter,
    ExtensionMode,
    FileChangeType,
    FileDecoration,
    FileSystemError,
    FileType,
    FoldingRange,
    FoldingRangeKind,
    Hover,
    InlayHint,
    InlineCompletionItem,
    InlineCompletionList,
    InlineCompletionTriggerKind,
    InputBoxValidationSeverity,
    LanguageStatusSeverity,
    Location,
    LogLevel,
    MarkdownString,
    OverviewRulerLane,
    ParameterInformation,
    Position,
    ProgressLocation,
    Range,
    RelativePattern,
    Selection,
    SignatureHelp,
    SignatureHelpTriggerKind,
    SignatureInformation,
    SnippetString,
    SnippetTextEdit,
    StatusBarAlignment,
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
    TextEditorSelectionChangeKind,
    ThemeColor,
    TypeHierarchyItem,
    Uri,
    ViewColumn,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
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
    // WP4: commands bridge поверх симметричного rpc (локальная Map команд +
    // прокси в host CommandRegistry). Геттер активного редактора нужен
    // registerTextEditorCommand — команда исполняется только при активном редакторе.
    // Собирается ДО languages: applyCodeAction исполняет команды действий.
    const commands = buildCommandsNamespace(rpc, () => window.activeTextEditor);
    const { languages } = createLanguagesNamespace(ctx, {
        // Правки code action ложатся тем же путём, что workspace.applyEdit;
        // команды действия — локальный реестр с прокси-мостом до хоста.
        applyEdit: (edit) => workspace.applyEdit(edit),
        executeCommand: (command, ...args) => commands.executeCommand(command, ...args),
    });

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

    // Наивный `extensions` — каталог установленных расширений субпроцессу не
    // раздаётся, поэтому getExtension честно отвечает undefined (для типового
    // потребителя это правильный ответ: pyright-семейство так детектит Pylance /
    // ms-python, которых в Diode действительно нет). Состав каталога в жизни
    // субпроцесса не меняется — onDidChange никогда не стреляет.
    const extensions = {
        all: [] as const,
        getExtension: (): undefined => undefined,
        onDidChange: new EventEmitter<void>().event,
    } as unknown;

    // Наивный `tasks` — провайдер регистрируется в никуда: слоя тасков в ядре
    // нет, и provideTasks никто никогда не позовёт (типовой потребитель —
    // vscode-eslint при `eslint.lintTask.enable: true`; без стаба включённая
    // пользователем настройка роняла бы клиент целиком). Настоящая проводка —
    // вместе со слоем тасков.
    const tasks = {
        registerTaskProvider: (): vscode.Disposable =>
            new DisposableImpl(() => undefined) as unknown as vscode.Disposable,
        taskExecutions: [] as const,
        onDidStartTask: new EventEmitter<never>().event,
        onDidEndTask: new EventEmitter<never>().event,
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
        // InlineCompletionItem/List конструирует конвертер languageclient на
        // каждом ответе inline-completion-сервера — классы обязаны быть настоящими.
        InlineCompletionItem,
        InlineCompletionList,
        InlineCompletionTriggerKind,
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
        // Класс-ловушка: конвертер клиента конструирует его на каждую диагностику
        // с related information, без него падала вся пачка диагностик.
        DiagnosticRelatedInformation,
        DiagnosticSeverity,
        DiagnosticTag,
        // Расширения строят сообщение валидации InputBox через этот enum —
        // он обязан быть настоящим значением, а не типом.
        InputBoxValidationSeverity,
        CodeLens,
        CodeAction,
        CodeActionKind,
        // CodeActionTriggerKind читает c2p-конвертер клиента на каждом запросе
        // code actions (asCodeActionTriggerKind) — enum обязан быть настоящим.
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
        // context.extensionMode сравнивают с enum'ом (basedpyright выбирает между
        // bundled-сервером и dev-обвязкой) — без runtime-поля сравнение всегда false.
        ExtensionMode,
        LogLevel,
        ProgressLocation,
        MarkdownString,
        Hover,
        // SignatureHelp/SignatureInformation/ParameterInformation конструирует
        // конвертер клиента на каждый ответ signature help, а
        // SignatureHelpTriggerKind он читает на каждом запросе.
        SignatureHelp,
        SignatureInformation,
        ParameterInformation,
        SignatureHelpTriggerKind,
        WorkspaceEdit,
        // SnippetTextEdit конструирует конвертер клиента на сниппет-правку
        // внутри WorkspaceEdit — без класса падала бы конвертация всего edit'а.
        SnippetTextEdit,
        // Расширение выбирает сторону полосы этим enum'ом на каждом
        // createStatusBarItem — без runtime-поля выравнивание всегда падало бы
        // в Left, а `item.alignment === vscode.StatusBarAlignment.Right` — в false.
        StatusBarAlignment,
        // Расширение сравнивает `window.activeColorTheme.kind` с этим enum'ом,
        // чтобы выбрать иконки/цвета под светлую и тёмную — без runtime-поля
        // любое сравнение давало бы false, и тема всегда «не та».
        ColorThemeKind,
        // `event.kind === vscode.TextEditorSelectionChangeKind.Mouse` —
        // типовой фильтр слушателя выделения; тоже обязан быть значением.
        TextEditorSelectionChangeKind,
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
        // Статус language server'а (languages.createLanguageStatusItem) — ruff
        // сравнивает и выставляет severity этим enum'ом на каждый апдейт статуса.
        LanguageStatusSeverity,
        window,
        workspace,
        languages,
        commands,
        env,
        extensions,
        // l10n без бандлов переводов: t подставляет плейсхолдеры, bundle/uri
        // честно undefined (ruff зовёт t на каждое пользовательское сообщение).
        l10n: createL10nNamespace(),
        tasks,
    } as unknown as typeof vscode;

    return { namespace, configStore: ctx.configStore };
}
