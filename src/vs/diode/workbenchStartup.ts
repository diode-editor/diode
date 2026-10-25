import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { mark } from "../base/common/performance.ts";
import { Uri } from "../base/common/uri.ts";
import { TokenizationRegistryDIToken } from "../editor/common/languages/tokenizationRegistry.ts";
import { MenuRegistryDIToken } from "../platform/actions/common/menuRegistry.ts";
import { CommandRegistryDIToken } from "../platform/commands/common/commandRegistry.ts";
import { ContextKeyServiceDIToken } from "../platform/contextkey/common/contextKeyService.ts";
import type { IStartupTargets, IStartupWorkspace } from "../platform/environment/node/startupTargets.ts";
import type { IExtension } from "../platform/extensions/common/iExtension.ts";
import type { ServiceAccessor } from "../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistryDIToken } from "../platform/keybinding/common/keybindingRegistry.ts";
import type { ILogger } from "../platform/log/common/iLogger.ts";
import { ExtensionViewWelcomesDIToken } from "../workbench/api/browser/extensionViewWelcomes.ts";
import { registerExtensionViews } from "../workbench/api/browser/viewsExtensionPoint.ts";
import { readViewsWelcome } from "../workbench/api/browser/viewsWelcomeExtensionPoint.ts";
import { ViewsServiceDIToken } from "../workbench/browser/parts/views/viewsService.ts";
import { WorkbenchComponentDIToken } from "../workbench/browser/workbenchComponent.ts";
import { EditorServiceDIToken } from "../workbench/services/editor/common/editorService.ts";
import { registerExtensionKeybindings } from "../workbench/services/extensions/common/extensionKeybindingContributor.ts";
import { registerExtensionMenus } from "../workbench/services/extensions/common/extensionMenuContributor.ts";
import { LifecycleServiceDIToken } from "../workbench/services/lifecycle/browser/lifecycleService.ts";
import { NotificationServiceDIToken } from "../workbench/services/notification/browser/notificationService.ts";
import { TerminalEnvironmentServiceDIToken } from "../workbench/services/terminalEnvironment/node/terminalEnvironmentService.ts";

export interface IWorkbenchStartupHost {
    attachRoot(view: BodyElement): void;
    run(): void;
    afterMounted(): Promise<void>;
    preloadGrammars(files: readonly string[]): Promise<void>;
    /** Not awaited: a hung extension `activate()` must not delay `eventually`. */
    startExtensions(): void;
    /** `setImmediate`: the deferred render sits earlier in the same queue. */
    afterNextFrame(callback: () => void): void;
}

export interface IWorkbenchStartupOptions {
    readonly targets: IStartupTargets;
    /** Then `targets.folder` is its folder. */
    readonly workspace?: IStartupWorkspace;
    readonly extensions: readonly IExtension[];
    readonly extensionsLogger?: ILogger;
}

/**
 * Counterpart of upstream `Workbench.startup` + `restore`. The step order is an invariant:
 *
 * 1. Extension keybindings after builtin ones (registered by the `WorkbenchComponent` constructor), so that
 *    an extension overrides a built-in chord.
 * 2. Workspace folder before `mount()`: layout restore reads the workspace storage.
 * 3. Tokenizers are held until the first frame: the first tokenization compiles the grammar regexes
 *    (TypeScript: ~160 ms) and would delay the text. The first frame has no highlighting, as in upstream.
 * 4. Extensions after the highlighted frame, like upstream `NativeExtensionService`: the spawn is synchronous.
 *    Early activation events (`onLanguage:` of an open file) are remembered by the `ExtensionService` barrier.
 * 5. `eventually` after the colored frame: warming up all grammars (~150 ms) would land before it.
 *    The `mount()` phase won't do — it runs before `run()`.
 *
 * The bench reads the `mark` calls; no extra `await` is allowed before `main:files-opened`.
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
    // Before mount(): extension containers are built with the built-in ones, and layout restore finds them.
    registerExtensionViews(options.extensions, {
        views: accessor.get(ViewsServiceDIToken),
        commands: accessor.get(CommandRegistryDIToken),
        contextKeys: accessor.get(ContextKeyServiceDIToken),
        notify: (message) => notifications.show({ severity: "warn", message, modal: false, items: [] }),
        logger: options.extensionsLogger,
    });
    accessor
        .get(ExtensionViewWelcomesDIToken)
        .registerContents(readViewsWelcome(options.extensions, options.extensionsLogger));

    // Without an explicit folder the window is empty — no scan of the current directory.
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
    // Only the languages being opened (~2 ms), not all grammars (~420 ms).
    await host.preloadGrammars(startupFiles);
    mark("main:grammars-preloaded");
    if (targets.diff !== undefined) {
        // A missing file legitimately yields an empty side.
        await accessor
            .get(CommandRegistryDIToken)
            .execute("vscode.diff", Uri.file(targets.diff.original), Uri.file(targets.diff.modified));
    } else if (explicitFiles.length > 0) {
        for (const file of explicitFiles) workbench.openFile(file.path);
        // CLI coordinates are 1-based, the editor's are 0-based.
        const last = explicitFiles[explicitFiles.length - 1];
        if (last.line !== undefined) {
            // Stryker disable next-line OptionalChaining: openFile always makes the opened tab active (a missing file is an empty buffer), so null is unreachable here; `?.` is a type safeguard
            accessor
                .get(EditorServiceDIToken)
                .getActiveEditor()
                ?.goToPosition(last.line - 1, (last.column ?? 1) - 1);
        }
    } else if (targets.folder !== undefined) {
        workbench.restoreOpenEditors();
    }
    workbench.focusEditor();
    // The text frame is the first `frame` after this mark.
    mark("main:files-opened", { files: startupFiles.length });
    lifecycle.setPhase("restored");

    host.afterNextFrame(() => {
        tokenizersHeld.dispose();
        host.afterNextFrame(() => {
            // The tmux poll is a spawn (~20 ms synchronous), so it goes after the frames.
            terminalEnv.detectTmuxClient();
            host.startExtensions();
            lifecycle.setPhase("eventually");
            mark("main:startup-complete");
        });
    });
}
