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
import { TerminalEnvironmentServiceDIToken } from "../workbench/services/terminalEnvironment/node/terminalEnvironmentService.ts";

export interface IWorkbenchStartupHost {
    attachRoot(view: BodyElement): void;
    run(): void;
    afterMounted(): Promise<void>;
    preloadGrammars(files: readonly string[]): Promise<void>;
    /** Не ожидается: повисший `activate()` расширения не должен откладывать `eventually`. */
    startExtensions(): void;
    /** `setImmediate`: отложенный рендер стоит в той же очереди раньше. */
    afterNextFrame(callback: () => void): void;
}

export interface IWorkbenchStartupOptions {
    readonly targets: IStartupTargets;
    /** Тогда `targets.folder` — его папка. */
    readonly workspace?: IStartupWorkspace;
    readonly extensions: readonly IExtension[];
    readonly extensionsLogger?: ILogger;
}

/**
 * Аналог `Workbench.startup` + `restore` у vscode. Порядок шагов — инварианты:
 *
 * 1. Бинды расширений — после builtin (их заводит конструктор `WorkbenchComponent`), чтобы
 *    расширение перебивало встроенный аккорд.
 * 2. Папка воркспейса — до `mount()`: рестор layout'а читает стор воркспейса.
 * 3. Токенизаторы придержаны до первого кадра: первая токенизация компилирует regex'ы грамматики
 *    (TypeScript — ~160 мс) и откладывала бы текст. Первый кадр без подсветки, как у эталона.
 * 4. Расширения — после кадра с подсветкой, как `NativeExtensionService` эталона: спаун синхронный.
 *    Ранние события активации (`onLanguage:` открытого файла) помнит барьер `ExtensionService`.
 * 5. `eventually` — после кадра с цветом: прогрев всех грамматик (~150 мс) встал бы перед ним.
 *    Из `mount()` фаза не годится — он идёт до `run()`.
 *
 * Вехи `mark` читает бенч; лишних `await` до `main:files-opened` быть не должно.
 */
export async function startWorkbench(
    accessor: ServiceAccessor,
    options: IWorkbenchStartupOptions,
    host: IWorkbenchStartupHost,
): Promise<void> {
    const { targets } = options;
    const workbench = accessor.get(WorkbenchComponentDIToken);
    const lifecycle = accessor.get(LifecycleServiceDIToken);
    const terminalEnv = accessor.get(TerminalEnvironmentServiceDIToken);
    const tokenizersHeld = accessor.get(TokenizationRegistryDIToken).hold();

    registerExtensionKeybindings(options.extensions, accessor.get(KeybindingRegistryDIToken), options.extensionsLogger);
    registerExtensionMenus(options.extensions, accessor.get(MenuRegistryDIToken), options.extensionsLogger);
    const notifications = accessor.get(NotificationServiceDIToken);
    registerExtensionViewFocusCommands(
        options.extensions,
        accessor.get(CommandRegistryDIToken),
        (message) => notifications.show({ severity: "warn", message, modal: false, items: [] }),
        options.extensionsLogger,
    );

    // Без явной папки окно пустое — никакого обхода текущего каталога.
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
    // Только открываемые языки (~2 мс), а не все грамматики (~420 мс).
    await host.preloadGrammars(startupFiles);
    mark("main:grammars-preloaded");
    if (targets.diff !== undefined) {
        // Отсутствующий файл легитимно даёт пустую сторону.
        await accessor
            .get(CommandRegistryDIToken)
            .execute("vscode.diff", Uri.file(targets.diff.original), Uri.file(targets.diff.modified));
    } else if (explicitFiles.length > 0) {
        for (const file of explicitFiles) workbench.openFile(file.path);
        // Координаты CLI 1-based, редактора — 0-based.
        const last = explicitFiles[explicitFiles.length - 1];
        if (last.line !== undefined) {
            // Stryker disable next-line OptionalChaining: openFile всегда делает открытую вкладку активной (отсутствующий файл — пустой буфер), null тут недостижим; `?.` — страховка типа
            accessor
                .get(EditorServiceDIToken)
                .getActiveEditor()
                ?.goToPosition(last.line - 1, (last.column ?? 1) - 1);
        }
    } else if (targets.folder !== undefined) {
        workbench.restoreOpenEditors();
    }
    workbench.focusEditor();
    // Кадр с текстом — первый `frame` после этой вехи.
    mark("main:files-opened", { files: startupFiles.length });
    lifecycle.setPhase("restored");

    host.afterNextFrame(() => {
        tokenizersHeld.dispose();
        host.afterNextFrame(() => {
            // Опрос tmux — спаун (~20 мс синхронно), поэтому за кадрами.
            terminalEnv.detectTmuxClient();
            host.startExtensions();
            lifecycle.setPhase("eventually");
            mark("main:startup-complete");
        });
    });
}
