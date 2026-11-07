import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { vi } from "vitest";

import { Emitter } from "../vs/base/common/event.ts";
import type { Uri } from "../vs/base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../vs/editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../vs/editor/common/languages/tokenizationRegistry.ts";
import type { IConfigurationService } from "../vs/platform/configuration/common/iConfigurationService.ts";
import type { ProgressService } from "../vs/platform/progress/common/progressService.ts";
import { bindWidgetGlyphs } from "../vs/platform/theme/browser/widgetGlyphs.ts";
import { type IProductIconService, StaticProductIconService } from "../vs/platform/theme/common/productIconService.ts";
import type { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../vs/platform/undoRedo/common/undoRedoService.ts";
import type { IViewsHarness } from "../vs/workbench/browser/parts/views/viewsService.testUtils.ts";
import {
    resolveTerminalColors,
    type TerminalColorsService,
} from "../vs/workbench/contrib/terminal/browser/terminalColorsService.ts";
import { ExtensionPtySession } from "../vs/workbench/contrib/terminal/node/extensionPtySession.ts";
import { TestMessageDiffFactory } from "../vs/workbench/contrib/testing/browser/testMessageDiff.ts";
import {
    TEST_RESULTS_CONTAINER_ID,
    TestResultsComponent,
} from "../vs/workbench/contrib/testing/browser/testResultsView.ts";
import type { TestResultService } from "../vs/workbench/contrib/testing/common/testResultService.ts";
import { NULL_JUMP_RECORDER } from "../vs/workbench/services/history/browser/historyService.ts";
import type { NotificationService } from "../vs/workbench/services/notification/browser/notificationService.ts";

import { diskFileService } from "./diskFileService.ts";
import { TestApp } from "./TestApp.ts";

/** Where the panel opened an editor: the uri, the 0-based line and character. */
export interface IOpenedLocation {
    readonly uri: string;
    readonly line: number;
    readonly character: number;
}

export interface IResultsPanelOptions {
    readonly results: TestResultService;
    readonly views: IViewsHarness;
    readonly theme: WorkbenchTheme;
    readonly configuration: IConfigurationService;
    readonly progress: ProgressService;
    readonly icons?: IProductIconService;
    readonly width?: number;
    readonly height?: number;
    /** The toasts' messages go here. */
    readonly toasts?: string[];
    /** The toasts as shown go here. */
    readonly toastOptions?: unknown[];
}

/**
 * The TEST RESULTS component over the views harness, its output in a real emulator, and its container's body as the
 * panel shows it.
 */
export function createResultsPanel(options: IResultsPanelOptions) {
    const { views } = options;
    const icons = options.icons ?? new StaticProductIconService(false);
    const colors = { colors: resolveTerminalColors(options.theme, undefined), onDidChange: new Emitter<never>().event };
    const opened: IOpenedLocation[] = [];
    /** The editors the editor's configuration was applied to: the diffs' sides. */
    const configuredPanes: unknown[] = [];
    let openedUri = "";
    const revealTarget = {
        openUri: (uri: Uri) => {
            openedUri = uri.toString();
        },
        getActiveEditor: () => ({
            goToPosition: (line: number, character = 0) => opened.push({ uri: openedUri, line, character }),
            revealRange: () => undefined,
        }),
    };
    const diffs = new TestMessageDiffFactory(
        NULL_LANGUAGE_SERVICE,
        new UndoRedoService(),
        diskFileService(),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        { editorConfiguration: { apply: (pane: unknown) => configuredPanes.push(pane) } } as never,
    );
    const toasts = options.toasts ?? [];
    const toastOptions = options.toastOptions ?? [];
    const notifications = {
        show: (toast: { message: string }) => {
            toasts.push(toast.message);
            toastOptions.push(toast);
        },
    } as unknown as NotificationService;
    const component = new TestResultsComponent(
        options.results,
        views.service,
        views.contextKeys,
        icons,
        options.progress,
        views.contextMenu,
        views.commands,
        options.configuration,
        (sessionOptions) => new ExtensionPtySession(sessionOptions),
        colors as unknown as TerminalColorsService,
        views.menuService,
        diffs,
        revealTarget,
        NULL_JUMP_RECORDER,
        notifications,
    );
    const width = options.width ?? 60;
    const height = options.height ?? 10;
    let app: TestApp | null = null;
    let appRoot: unknown = null;
    const show = (): TestApp => {
        const root = views.root(TEST_RESULTS_CONTAINER_ID);
        if (app === null || root !== appRoot) {
            bindWidgetGlyphs(root, icons);
            app = TestApp.createWithContent(root, new Size(width, height));
            appRoot = root;
        }
        return app;
    };
    const frame = (): string => {
        const shown = show();
        shown.render();
        return shown.backend.screenToString();
    };
    return {
        component,
        /** The places the panel opened, in order. */
        opened,
        configuredPanes,
        width,
        frame,
        lines: (): string[] => frame().split("\n"),
        waitFrame: (predicate: (text: string) => boolean, timeout?: number): Promise<string> =>
            vi.waitFor(
                () => {
                    const text = frame();
                    if (!predicate(text)) throw new Error(`the panel is not there yet:\n${text}`);
                    return text;
                },
                { timeout },
            ),
        fgAt: (x: number, y: number): number => {
            frame();
            return show().backend.getFgAt(new Point(x, y));
        },
        click: (x: number, y: number, button: "left" | "middle" | "right" = "left"): void => {
            for (const action of ["press", "release"] as const) {
                show().backend.simulateMouse({
                    kind: "mouse",
                    button,
                    x: x + 1,
                    y: y + 1,
                    action,
                    shiftKey: false,
                    altKey: false,
                    ctrlKey: false,
                    raw: "",
                });
                show().render();
            }
        },
        sendKey: (key: string): void => {
            show().backend.sendKey(key);
            show().render();
        },
    };
}
