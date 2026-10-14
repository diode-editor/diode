import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { mark } from "../base/common/performance.ts";
import { Uri } from "../base/common/uri.ts";
import { TokenizationRegistryDIToken } from "../editor/common/languages/tokenizationRegistry.ts";
import { MenuRegistryDIToken } from "../platform/actions/common/menuRegistry.ts";
import { CommandRegistryDIToken } from "../platform/commands/common/commandRegistry.ts";
import type { IStartupTargets, IStartupWorkspace } from "../platform/environment/node/startupTargets.ts";
import type { IExtension } from "../platform/extensions/common/iExtension.ts";
import type { ServiceAccessor } from "../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistryDIToken } from "../platform/keybinding/common/keybindingRegistry.ts";
import type { ILogger } from "../platform/log/common/iLogger.ts";
import { WorkbenchComponentDIToken } from "../workbench/browser/workbenchComponent.ts";
import { EditorServiceDIToken } from "../workbench/services/editor/common/editorService.ts";
import { registerExtensionKeybindings } from "../workbench/services/extensions/common/extensionKeybindingContributor.ts";
import { registerExtensionMenus } from "../workbench/services/extensions/common/extensionMenuContributor.ts";
import { registerExtensionViewFocusCommands } from "../workbench/services/extensions/common/extensionViewFocusCommands.ts";
import { LifecycleServiceDIToken } from "../workbench/services/lifecycle/browser/lifecycleService.ts";
import { NotificationServiceDIToken } from "../workbench/services/notification/browser/notificationService.ts";

/**
 * То, что стартовая последовательность делает руками владельца процесса: у
 * приложения это `TuiApplication`, инспектор, прогрев грамматик и extension
 * host, у теста — `TestApp` и заглушки.
 */
export interface IWorkbenchStartupHost {
    /** До `mount()`: корень рендера смотрит на view окна (`app.root = view`). */
    attachRoot(view: BodyElement): void;
    /** Сразу после `mount()`: цикл рендера пошёл (`app.run()`). */
    run(): void;
    /** После вехи `workbench:mounted`, до `activate()` (инспектор). */
    afterMounted(): Promise<void>;
    /** Грамматики стартовых файлов — ДО открытия (см. {@link startWorkbench}). */
    preloadGrammars(files: readonly string[]): Promise<void>;
    /**
     * В фазе `restored`: регистрация расширений и стартовая активация. Не
     * ожидается — `eventually` от активации не зависит (повисший `activate()`
     * расширения не должен откладывать фоновую работу окна).
     */
    afterRestored(): void;
    /**
     * Отложить колбэк за ближайший кадр (`setImmediate`: отложенный рендер
     * стоит в той же очереди раньше).
     */
    afterNextFrame(callback: () => void): void;
}

export interface IWorkbenchStartupOptions {
    readonly targets: IStartupTargets;
    /**
     * Файл воркспейса, если окно открывается через него (`diode
     * web.code-workspace`); тогда `targets.folder` — его папка.
     */
    readonly workspace?: IStartupWorkspace;
    /** Все расширения (builtin + user) — для их `contributes.keybindings`. */
    readonly extensions: readonly IExtension[];
    readonly extensionsLogger?: ILogger;
}

/**
 * Стартовая последовательность окна — от собранного контейнера до фазы
 * `eventually` (аналог `Workbench.startup` + `restore` у vscode). Порядок
 * шагов — инварианты, которые раньше держались только комментариями в `main.ts`:
 *
 * 1. `contributes.keybindings` расширений — ПОСЛЕ builtin-биндингов (их заводит
 *    конструктор `WorkbenchComponent`), чтобы расширение могло переопределить
 *    встроенный аккорд.
 * 2. Папка воркспейса — ДО `mount()`: рестор layout'а читает стор воркспейса.
 * 3. `mount()` — фаза `ready` (её двигает сам `mount`), затем цикл рендера.
 * 4. Грамматики стартовых файлов грузятся ДО открытия, а токенизация — ПОСЛЕ
 *    первого кадра: реестр токенизаторов придержан до него
 *    (`TokenizationRegistry.hold`). Первый кадр — текст без подсветки (как у
 *    эталона): первая токенизация компилирует regex'ы грамматики (TypeScript —
 *    ~160 мс), и в кадре она откладывала бы текст. Цвет — следующим кадром, без
 *    ожидания загрузки: грамматика уже на руках.
 * 5. Открытие (дифф / файлы с `--goto` / рестор сессии) — фаза `restored`.
 * 6. Расширения регистрируются после открытия, но `eventually` их активацию
 *    не ждёт.
 * 7. Отпуск токенизаторов — после первого кадра, фаза `eventually` — после
 *    следующего, с подсветкой: её фоновая работа (прогрев всех грамматик,
 *    ~150 мс) встала бы перед кадром с цветом. Из самого `mount()` фаза не
 *    годится: он идёт до `run()` и сработал бы раньше любого кадра.
 *
 * Вехи трассы старта (`mark`) — те же имена, что читает бенч; лишних `await`
 * до `main:files-opened` здесь нет и быть не должно.
 */
export async function startWorkbench(
    accessor: ServiceAccessor,
    options: IWorkbenchStartupOptions,
    host: IWorkbenchStartupHost,
): Promise<void> {
    const { targets } = options;
    const workbench = accessor.get(WorkbenchComponentDIToken);
    const lifecycle = accessor.get(LifecycleServiceDIToken);
    const tokenizersHeld = accessor.get(TokenizationRegistryDIToken).hold();

    registerExtensionKeybindings(options.extensions, accessor.get(KeybindingRegistryDIToken), options.extensionsLogger);
    // Пункты меню расширений — до первого открытия меню: состав точек реестр
    // отдаёт по запросу, а регистрация стоит рядом с биндами того же манифеста.
    registerExtensionMenus(options.extensions, accessor.get(MenuRegistryDIToken), options.extensionsLogger);
    // `<вид>.focus` объявленных видов расширений — до активации: расширение
    // зовёт её из своих команд, а вида у нас нет, и человек должен узнать почему.
    const notifications = accessor.get(NotificationServiceDIToken);
    registerExtensionViewFocusCommands(
        options.extensions,
        accessor.get(CommandRegistryDIToken),
        (message) => notifications.show({ severity: "warn", message, modal: false, items: [] }),
        options.extensionsLogger,
    );

    // Папка воркспейса — только если её назвали явно. Без неё окно поднимается
    // пустым: ни Explorer-корня, ни индекса файлов, ни workspaceFolders у
    // расширений (и, значит, никакого обхода текущего каталога).
    if (options.workspace !== undefined) {
        workbench.openWorkspaceFile(options.workspace.file, options.workspace.contents);
    } else if (targets.folder !== undefined) {
        workbench.setWorkspaceFolder(targets.folder);
    }

    host.attachRoot(workbench.view);
    workbench.mount();
    host.run();
    mark("workbench:mounted");

    await host.afterMounted();

    await workbench.activate();
    mark("workbench:activated");
    const explicitFiles = targets.files;
    const diffSides = targets.diff === undefined ? [] : [targets.diff.original, targets.diff.modified];
    // Что откроется на старте — для прогрева грамматик. Явные файлы (и стороны
    // диффа) перебивают сохранённую сессию (как `code file.ts`); без них сессию
    // восстанавливаем, но только когда есть воркспейс: у пустого окна сессии нет.
    let startupFiles: readonly string[];
    if (diffSides.length > 0) {
        startupFiles = diffSides;
    } else if (explicitFiles.length > 0) {
        startupFiles = explicitFiles.map((f) => f.path);
    } else if (targets.folder !== undefined) {
        startupFiles = workbench.getOpenEditorsToRestore();
    } else {
        startupFiles = [];
    }
    // Ждём именно те языки, что открываются (обычно один, ~2 мс), а не все
    // грамматики (~420 мс); остальные догоняет фоновый прогрев в `eventually`.
    await host.preloadGrammars(startupFiles);
    mark("main:grammars-preloaded");
    if (targets.diff !== undefined) {
        // Тот же вход, что у расширений (`vscode.diff`): сторон-снимков тут нет,
        // отсутствующий файл легитимно даёт пустую сторону.
        await accessor
            .get(CommandRegistryDIToken)
            .execute("vscode.diff", Uri.file(targets.diff.original), Uri.file(targets.diff.modified));
    } else if (explicitFiles.length > 0) {
        for (const file of explicitFiles) workbench.openFile(file.path);
        // `--goto`: каретка в указанную позицию последнего открытого файла —
        // он же активный. Координаты CLI 1-based, редактора — 0-based.
        const last = explicitFiles[explicitFiles.length - 1];
        if (last.line !== undefined) {
            // Stryker disable next-line OptionalChaining: openFile всегда делает открытую вкладку активной (отсутствующий файл — пустой буфер), null тут недостижим; `?.` — страховка типа
            accessor
                .get(EditorServiceDIToken)
                .getActiveEditor()
                ?.goToPosition(last.line - 1, (last.column ?? 1) - 1);
        }
    } else if (targets.folder !== undefined) {
        // Иначе восстанавливаем открытые файлы прошлой сессии этого воркспейса.
        workbench.restoreOpenEditors();
    }
    workbench.focusEditor();
    // Вкладки с файлами созданы; кадр с текстом — первый `frame` после этой вехи.
    mark("main:files-opened", { files: startupFiles.length });
    lifecycle.setPhase("restored");

    host.afterRestored();

    host.afterNextFrame(() => {
        tokenizersHeld.dispose();
        host.afterNextFrame(() => {
            lifecycle.setPhase("eventually");
            mark("main:startup-complete");
        });
    });
}
