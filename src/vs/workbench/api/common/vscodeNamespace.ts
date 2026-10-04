import { randomUUID } from "node:crypto";

import type * as vscode from "vscode";

import { UI_LOCALE } from "../../../platform/environment/common/uiLocale.ts";

import { implementsApi } from "./apiSurface.ts";
import { buildCommandsNamespace } from "./commandsNamespace.ts";
import { createExtensionSecretsFactory, type IExtensionSecretsFactory } from "./extensionSecrets.ts";
import { createExtensionsNamespace } from "./extensionsNamespace.ts";
import type { IExtHostDisk } from "./extHostDisk.ts";
import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import { createL10nNamespace } from "./l10nNamespace.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
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
    CompletionItem,
    CompletionItemKind,
    CompletionItemTag,
    CompletionList,
    CompletionTriggerKind,
    ConfigurationTarget,
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
    ExtensionKind,
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
    TextDocumentChangeReason,
    TextDocumentSaveReason,
    TextEdit,
    TextEditorSelectionChangeKind,
    ThemeColor,
    TypeHierarchyItem,
    UIKind,
    Uri,
    ViewColumn,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { type IWireExtensionDescription, parseWireClipboardText, parseWireOpenExternalResult } from "./wireTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

/**
 * Результат сборки шима: сам объект `vscode` (раздаётся расширениям через
 * `Module._cache`) и {@link WorkspaceConfigStore}, в который приезжают слои
 * настроек главного процесса (`workspace.initialize` / `configurationChanged`).
 */
export interface IVscodeHost {
    readonly namespace: typeof vscode;
    readonly configStore: WorkspaceConfigStore;
    /**
     * Публичные API активированных расширений (id → возвращённое `activate()`),
     * которые отдаёт `extensions.getExtension(id).exports`. Наполняет точка
     * входа субпроцесса — только она видит результат `activate()`.
     */
    readonly extensionExports: Map<string, unknown>;
    /** Фабрика `ExtensionContext.secrets` — по одному хранилищу на расширение. */
    readonly secrets: IExtensionSecretsFactory;
    /** Владелец создающего вызова — его выставляет оверлей расширения (`extensionApiFactory.ts`). */
    readonly owner: ExtensionOwner;
    /** Каталог расширений от хоста — по нему индексируются их корни. */
    readonly onDidReceiveCatalog: vscode.Event<readonly IWireExtensionDescription[]>;
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

    const window = createWindowNamespace(ctx);
    const workspace = createWorkspaceNamespace(ctx);
    // WP4: commands bridge поверх симметричного rpc (локальная Map команд +
    // прокси в host CommandRegistry). Геттер активного редактора нужен
    // registerTextEditorCommand — команда исполняется только при активном редакторе.
    // Собирается ДО languages: applyCodeAction исполняет команды действий.
    const commands = buildCommandsNamespace(rpc, () => window.activeTextEditor, ctx.owner);
    const { languages } = createLanguagesNamespace(ctx, {
        // Правки code action ложатся тем же путём, что workspace.applyEdit;
        // команды действия — локальный реестр с прокси-мостом до хоста.
        applyEdit: (edit) => workspace.applyEdit(edit),
        executeCommand: (command, ...args) => commands.executeCommand(command, ...args),
    });

    // `env`: буфер обмена и открытие ссылки живут у хоста — он владеет
    // терминалом (OSC 52) и правом запускать системный обработчик, поэтому
    // расширение ходит туда запросами. Остальное — константы шима
    // (vscode-languageclient читает language/appName).
    const env = {
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
        /**
         * `true` — ссылка доехала до человека: либо её открыл системный
         * обработчик, либо (без графического окружения — ssh, контейнер, голый
         * сервер) хост показал URL сообщением и положил в буфер обмена. `false`
         * — не удалось ни то, ни другое.
         */
        openExternal: async (target: vscode.Uri): Promise<boolean> =>
            parseWireOpenExternalResult(
                // `toString(true)` — skipEncoding, как в эталоне (там ссылка
                // уезжает системному обработчику ровно в этой форме). Обычный
                // `toString()` percent-кодирует `=`/`&` в query, и вместо
                // `?token=42` системе досталось бы `?token%3D42`.
                await rpc.request("env.openExternal", { uri: target.toString(true) }),
            ),

        /**
         * Идентификатор сеанса extension host'а. Читается как «тот же запуск или
         * уже другой» (`redhat.java` этим отличает свою запись-однодневку на
         * диске от чужой), поэтому важны два свойства: стабильность внутри
         * запуска и несовпадение между запусками — оба даёт `randomUUID()` на
         * сборке шима. Отступление от эталона: там id переживает перезапуск
         * extension host'а, у нас — нет (шим собирается заново вместе с
         * субпроцессом).
         */
        sessionId: randomUUID(),

        /**
         * Телеметрии в Diode нет вовсе — ни своей, ни канала для чужой. Это не
         * стаб «пока не сделали», а постоянный ответ, поэтому
         * `onDidChangeTelemetryEnabled` — валидное событие, которое никогда не
         * стреляет: менять нечего. Расширение, уважающее флаг (redhat-телеметрия
         * спрашивает его на каждом событии), само ничего не отправит.
         */
        isTelemetryEnabled: false,
        onDidChangeTelemetryEnabled: new EventEmitter<boolean>().event,

        /**
         * Удалённого extension host'а нет — `undefined` по букве контракта
         * («value is `undefined` when there is no remote extension host»).
         */
        remoteName: undefined,

        // Редактор настольный, пусть и в терминале: `Web` в контракте значит
        // «доступ из браузера» (vscode.dev), а не «не-графический UI».
        uiKind: UIKind.Desktop,
    };

    // Каталог установленных расширений приезжает от хоста (`extensions.catalog`
    // семенем ДО первой активации, `extensions.activated` — на каждое оживление).
    // Именно этим соседей детектят AI-автодополнения: раньше им всегда отвечали
    // «ничего не установлено».
    const { extensions, exportsById, onDidReceiveCatalog } = createExtensionsNamespace(rpc);
    // Секреты расширения (`ExtensionContext.secrets`) — тоже за хостом: он
    // владеет user-data, в которой они переживают перезапуск.
    const secrets = createExtensionSecretsFactory(rpc);

    // Наивный `tasks` — провайдер регистрируется в никуда: слоя тасков в ядре
    // нет, и provideTasks никто никогда не позовёт (типовой потребитель —
    // vscode-eslint при `eslint.lintTask.enable: true`; без стаба включённая
    // пользователем настройка роняла бы клиент целиком). Настоящая проводка —
    // вместе со слоем тасков.
    const tasks = {
        registerTaskProvider: (): vscode.Disposable => new DisposableImpl(() => undefined),
        taskExecutions: [] as const,
        onDidStartTask: new EventEmitter<never>().event,
        onDidEndTask: new EventEmitter<never>().event,
    };

    const namespace = {
        // vscode-languageclient требует валидный VS Code semver (^1.91.0).
        // Лок-степ с extensions/VSCODE_VERSION — проверяет vscodeNamespace.identity.test.
        version: VSCODE_SHIM_VERSION,
        Disposable: DisposableImpl,
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
        // Точечный каст (и у трёх классов ниже, которые держат SnippetString в
        // полях): у нашего SnippetString только `appendText`, и тот без
        // экранирования; билдеров `appendTabstop`/`appendPlaceholder`/
        // `appendChoice`/`appendVariable` из d.ts нет — это новый функционал.
        SnippetString: SnippetString as unknown as typeof vscode.SnippetString,
        // InlineCompletionItem/List конструирует конвертер languageclient на
        // каждом ответе inline-completion-сервера — классы обязаны быть настоящими.
        InlineCompletionItem: InlineCompletionItem as unknown as typeof vscode.InlineCompletionItem,
        InlineCompletionList: InlineCompletionList as unknown as typeof vscode.InlineCompletionList,
        InlineCompletionTriggerKind,
        EndOfLine,
        TextDocumentSaveReason,
        // Оба enum'а объявлены в активном d.ts, но рантайм-поля не было:
        // `vscode.ConfigurationTarget.Global` падал на чтении у undefined.
        TextDocumentChangeReason,
        ConfigurationTarget,
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
        // `ext.extensionKind === vscode.ExtensionKind.Workspace` — тем же
        // сравнением расширение решает, «свой» ли ему сосед из extensions.all.
        ExtensionKind,
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
        SnippetTextEdit: SnippetTextEdit as unknown as typeof vscode.SnippetTextEdit,
        // Расширение выбирает сторону полосы этим enum'ом на каждом
        // createStatusBarItem — без runtime-поля выравнивание всегда падало бы
        // в Left, а `item.alignment === vscode.StatusBarAlignment.Right` — в false.
        StatusBarAlignment,
        // `switch (env.uiKind) { case vscode.UIKind.Desktop: ... }` — типовой
        // разбор окружения в `activate()`; без runtime-поля он падал бы на
        // чтении `Desktop` у undefined, унося с собой всю активацию.
        UIKind,
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
        env: implementsApi<typeof vscode.env>()(env),
        extensions,
        // l10n без бандлов переводов: t подставляет плейсхолдеры, bundle/uri
        // честно undefined (ruff зовёт t на каждое пользовательское сообщение).
        l10n: createL10nNamespace(),
        // `tasks` в активном d.ts ещё не объявлен — проверять не против чего.
        tasks,
    };

    return {
        namespace: implementsApi<typeof vscode>()(namespace),
        configStore: ctx.configStore,
        extensionExports: exportsById,
        secrets,
        owner: ctx.owner,
        onDidReceiveCatalog,
    };
}
