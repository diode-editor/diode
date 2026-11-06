import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { expect, vi } from "vitest";

import type { ICancellationToken } from "../vs/base/common/cancellation.ts";
import { Emitter } from "../vs/base/common/event.ts";
import type { IRange } from "../vs/editor/common/core/iRange.ts";
import { registerAction } from "../vs/platform/actions/common/commandAction.ts";
import type { MenuContribution } from "../vs/platform/actions/common/iMenuContribution.ts";
import type { IConfigurationService } from "../vs/platform/configuration/common/iConfigurationService.ts";
import { ContextKeyServiceDIToken } from "../vs/platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../vs/platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../vs/platform/keybinding/common/keybindingRegistry.ts";
import { type IProgressServiceOptions, ProgressService } from "../vs/platform/progress/common/progressService.ts";
import { bindWidgetGlyphs } from "../vs/platform/theme/browser/widgetGlyphs.ts";
import { type IProductIconService, StaticProductIconService } from "../vs/platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import {
    type IWireRunControllerTestsResult,
    type IWireStartControllerTests,
    type IWireTestItem,
    TestDiffOpType,
    type TestItemExpandState,
    type WireTestsDiffOp,
} from "../vs/workbench/api/common/testingWireTypes.ts";
import { menuItemsOfAction } from "../vs/workbench/browser/actions/menuContributions.ts";
import { makeViewsHarness } from "../vs/workbench/browser/parts/views/viewsService.testUtils.ts";
import { TESTING_ACTIONS } from "../vs/workbench/contrib/testing/browser/testingActions.ts";
import {
    TESTING_VIEWLET_ID,
    TestingExplorerComponent,
    TestingExplorerComponentDIToken,
} from "../vs/workbench/contrib/testing/browser/testingExplorerView.ts";
import {
    type ITestControllerRegistration,
    TestService,
    TestServiceDIToken,
} from "../vs/workbench/contrib/testing/common/testService.ts";
import { NULL_JUMP_RECORDER } from "../vs/workbench/services/history/browser/historyService.ts";
import type { NotificationService } from "../vs/workbench/services/notification/browser/notificationService.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";

import { TestApp } from "./TestApp.ts";
import { makeTestingServices } from "./testingServices.ts";
import { testId } from "./testTree.ts";

export const UNICODE_ICONS = new StaticProductIconService(false);
export const THEME = WorkbenchTheme.fromThemeFile(darkPlusTheme);

export interface IItemFields {
    readonly uri?: string;
    readonly range?: IRange | null;
    readonly description?: string | null;
    readonly error?: string | null;
    readonly sortText?: string | null;
    readonly tags?: readonly string[];
    readonly busy?: boolean;
}

/** `path` from the controller id; the label is the last segment unless given. */
export function wireItem(
    path: readonly string[],
    label = path[path.length - 1],
    fields: IItemFields = {},
): IWireTestItem {
    return {
        extId: testId(...path),
        label,
        tags: fields.tags ?? [],
        busy: fields.busy ?? false,
        uri: fields.uri,
        range: fields.range ?? null,
        description: fields.description ?? null,
        error: fields.error ?? null,
        sortText: fields.sortText ?? null,
    };
}

export function add(item: IWireTestItem, expand: TestItemExpandState): WireTestsDiffOp {
    return { op: TestDiffOpType.Add, item: { expand, item } };
}

export function update(
    path: readonly string[],
    patch: Partial<IWireTestItem>,
    expand?: TestItemExpandState,
): WireTestsDiffOp {
    const { extId: _id, uri: _uri, ...item } = patch;
    return { op: TestDiffOpType.Update, item: { extId: testId(...path), expand, item } };
}

export interface ISetupOptions {
    readonly width?: number;
    readonly height?: number;
    readonly menus?: readonly MenuContribution[];
    readonly settings?: Readonly<Record<string, unknown>>;
    readonly progress?: IProgressServiceOptions;
    readonly icons?: IProductIconService;
    /** `false`: the containers are attached by the test, as `mount()` does after the components exist. */
    readonly attach?: boolean;
    /** The results' clock. */
    readonly now?: () => number;
    /** Runs before the view is built: a controller that is there already. */
    readonly before?: (tests: TestService) => void;
}

/** Unicode glyphs until `useNerdFont()`, as `diode.icons.nerdFont` switched live. */
export class SwitchableIcons extends StaticProductIconService {
    private readonly onDidChangeEmitter = new Emitter<void>();
    public override readonly onDidChange = this.onDidChangeEmitter.event;

    public constructor() {
        super(false);
    }

    public useNerdFont(): void {
        (this as { nerdFont: boolean }).nerdFont = true;
        this.onDidChangeEmitter.fire();
    }
}

export function setupExplorer(options: ISetupOptions = {}) {
    const views = makeViewsHarness(
        [...TESTING_ACTIONS.flatMap((action) => menuItemsOfAction(action)), ...(options.menus ?? [])],
        UNICODE_ICONS,
    );
    const services = makeTestingServices({ contextKeys: views.contextKeys, now: options.now });
    const { tests } = services;
    const progress = new ProgressService(options.progress);
    const icons = options.icons ?? UNICODE_ICONS;
    const opened: string[] = [];
    const positions: [number, number | undefined][] = [];
    const toasts: string[] = [];
    const toastOptions: unknown[] = [];
    const reveal = {
        openUri: (uri: { toString(): string }) => {
            opened.push(uri.toString());
            // The editor takes the keyboard; the filter stands in for it.
            component.filterInput.focus();
        },
        getActiveEditor: () => ({
            goToPosition: (line: number, column?: number) => positions.push([line, column]),
            revealRange: () => undefined,
        }),
    };
    const settings: Record<string, unknown> = { "workbench.tree.renderIndentGuides": "none", ...options.settings };
    const onDidChangeConfiguration = new Emitter<{ affectsConfiguration(key: string): boolean }>();
    const configuration = {
        get: (key: string) => settings[key],
        onDidChangeConfiguration: onDidChangeConfiguration.event,
    } as unknown as IConfigurationService;
    /** A settings change as the configuration service reports it. */
    const setSetting = (key: string, value: unknown): void => {
        settings[key] = value;
        onDidChangeConfiguration.fire({ affectsConfiguration: (affected) => affected === key });
    };
    options.before?.(tests);
    const component = new TestingExplorerComponent(
        tests,
        views.service,
        views.contextKeys,
        icons,
        progress,
        views.menuService,
        views.menuRegistry,
        views.contextMenu,
        views.commands,
        configuration,
        reveal,
        NULL_JUMP_RECORDER,
        {
            show: (toast: { message: string }) => {
                toasts.push(toast.message);
                toastOptions.push(toast);
            },
        } as unknown as NotificationService,
    );
    const serviceMap = new Map<unknown, unknown>([
        [TestServiceDIToken, tests],
        [TestingExplorerComponentDIToken, component],
        [ContextKeyServiceDIToken, views.contextKeys],
    ]);
    const accessor = { get: (token: unknown) => serviceMap.get(token) } as unknown as ServiceAccessor;
    const keybindings = new KeybindingRegistry();
    for (const action of TESTING_ACTIONS) registerAction(views.commands, keybindings, accessor, action);
    if (options.attach !== false) views.service.attachRegisteredContainers();

    const expands: [string, number][] = [];
    /** The core's run requests per controller, answered by `finish`. */
    const runs: {
        readonly requests: readonly IWireStartControllerTests[];
        readonly token: ICancellationToken;
        finish(answers?: IWireRunControllerTestsResult[]): void;
    }[] = [];
    const cancels: string[] = [];
    const controllers = new Map<string, ITestControllerRegistration>();
    /** A controller whose root resolves on the view's request; the test publishes what it answers. */
    const registerController = (id: string, label = id, canRefresh = false): ITestControllerRegistration => {
        const registration = tests.registerTestController({
            id,
            label,
            canRefresh,
            expandTest: (testIdToExpand, levels) => {
                expands.push([testIdToExpand, levels]);
                return Promise.resolve();
            },
            refreshTests: () => Promise.resolve(),
            runTests: (requests, token) =>
                new Promise((resolve) => {
                    runs.push({
                        requests,
                        token,
                        finish: (answers = requests.map(() => ({}))) => {
                            resolve(answers);
                        },
                    });
                }),
            cancelTestRun: (runId, taskId) => {
                cancels.push(taskId === undefined ? runId : `${runId}/${taskId}`);
            },
        });
        controllers.set(id, registration);
        return registration;
    };

    const width = options.width ?? 40;
    const height = options.height ?? 12;
    let app: TestApp | null = null;
    let appRoot: unknown = null;
    /** The sidebar shows the container: the app renders its root. */
    const show = (): TestApp => {
        views.showViewlet(TESTING_VIEWLET_ID);
        const root = views.root(TESTING_VIEWLET_ID);
        // The container is built anew when its view comes back after the last controller left.
        if (app === null || root !== appRoot) {
            // The app's chevrons: Unicode, as the icon service draws them without a Nerd Font.
            bindWidgetGlyphs(root, UNICODE_ICONS);
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
    const lines = (): string[] => frame().split("\n");
    /** Where the frame shows `text`: a gesture goes where the user sees it. */
    const locate = (text: string): { x: number; y: number } => {
        const all = lines();
        const y = all.findIndex((line) => line.includes(text));
        expect(y, `"${text}" on the frame:\n${all.join("\n")}`).toBeGreaterThanOrEqual(0);
        return { x: all[y].indexOf(text), y };
    };
    /** The row whose label is exactly `label` (after its icon): a click on it. */
    const row = (label: string): { x: number; y: number } => {
        const all = lines();
        const pattern = new RegExp(`. ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
        const y = all.findIndex((line, index) => index > 2 && pattern.test(line));
        expect(y, `row "${label}" on the frame:\n${all.join("\n")}`).toBeGreaterThanOrEqual(0);
        return { x: all[y].indexOf(` ${label}`) + 1, y };
    };
    const waitFrame = (predicate: (text: string) => boolean): Promise<string> =>
        vi.waitFor(() => {
            const text = frame();
            if (!predicate(text)) throw new Error(`the frame is not there yet:\n${text}`);
            return text;
        });
    const fgAt = (x: number, y: number): number => {
        frame();
        return show().backend.getFgAt(new Point(x, y));
    };
    const bgAt = (x: number, y: number): number => {
        frame();
        return show().backend.getBgAt(new Point(x, y));
    };
    const sendKey = (key: string): void => {
        show().backend.sendKey(key);
        show().render();
    };
    const mouse = (
        x: number,
        y: number,
        kind: "press" | "release" | "move",
        button: "left" | "right" | "none" = "left",
    ) => {
        show().backend.simulateMouse({
            kind: "mouse",
            button,
            x: x + 1,
            y: y + 1,
            action: kind,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
        show().render();
    };
    const click = (x: number, y: number, button: "left" | "right" = "left"): void => {
        mouse(x, y, "press", button);
        mouse(x, y, "release", button);
    };
    return {
        views,
        tests,
        progress,
        component,
        opened,
        positions,
        toasts,
        toastOptions,
        expands,
        controllers,
        registerController,
        frame,
        lines,
        locate,
        row,
        waitFrame,
        fgAt,
        bgAt,
        sendKey,
        mouse,
        click,
        width,
        setSetting,
    };
}
