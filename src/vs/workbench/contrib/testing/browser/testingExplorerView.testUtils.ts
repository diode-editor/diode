import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import type { MenuContribution } from "../../../../platform/actions/common/iMenuContribution.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { bindWidgetGlyphs } from "../../../../platform/theme/browser/widgetGlyphs.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import {
    type IWireTestItem,
    TestDiffOpType,
    type TestItemExpandState,
    type WireTestsDiffOp,
} from "../../../api/common/testingWireTypes.ts";
import { menuItemsOfAction } from "../../../browser/actions/menuContributions.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { NULL_JUMP_RECORDER } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { type ITestControllerRegistration, TestService, TestServiceDIToken } from "../common/testService.ts";

import { TESTING_ACTIONS } from "./testingActions.ts";
import {
    TESTING_VIEWLET_ID,
    TestingExplorerComponent,
    TestingExplorerComponentDIToken,
} from "./testingExplorerView.ts";

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
export function wireItem(path: readonly string[], label = path.at(-1) ?? "", fields: IItemFields = {}): IWireTestItem {
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
}

export function setupExplorer(options: ISetupOptions = {}) {
    const views = makeViewsHarness(
        [...TESTING_ACTIONS.flatMap((action) => menuItemsOfAction(action)), ...(options.menus ?? [])],
        UNICODE_ICONS,
    );
    const tests = new TestService(views.contextKeys);
    const progress = new ProgressService();
    const opened: string[] = [];
    const positions: [number, number | undefined][] = [];
    const toasts: string[] = [];
    const reveal = {
        openUri: (uri: { toString(): string }) => {
            opened.push(uri.toString());
        },
        getActiveEditor: () => ({
            goToPosition: (line: number, column?: number) => positions.push([line, column]),
            revealRange: () => undefined,
        }),
    };
    const configuration = {
        get: (key: string) =>
            (({ "workbench.tree.renderIndentGuides": "none", ...options.settings }) as Record<string, unknown>)[key],
    } as unknown as IConfigurationService;
    const component = new TestingExplorerComponent(
        tests,
        views.service,
        views.contextKeys,
        UNICODE_ICONS,
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
            },
        } as unknown as NotificationService,
    );
    const accessor = {
        get: (token: unknown) => {
            if (token === TestServiceDIToken) return tests;
            if (token === TestingExplorerComponentDIToken) return component;
            if (token === ViewsServiceDIToken) return views.service;
            if (token === ContextKeyServiceDIToken) return views.contextKeys;
            throw new Error("not in the test accessor");
        },
    } as unknown as ServiceAccessor;
    const keybindings = new KeybindingRegistry();
    for (const action of TESTING_ACTIONS) registerAction(views.commands, keybindings, accessor, action);
    views.service.attachRegisteredContainers();

    const expands: [string, number][] = [];
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
        if (y < 0) throw new Error(`no "${text}" on the frame:\n${all.join("\n")}`);
        return { x: all[y].indexOf(text), y };
    };
    /** The row whose label is exactly `label` (after its icon): a click on it. */
    const row = (label: string): { x: number; y: number } => {
        const all = lines();
        const pattern = new RegExp(`. ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
        const y = all.findIndex((line, index) => index > 2 && pattern.test(line));
        if (y < 0) throw new Error(`no row "${label}" on the frame:\n${all.join("\n")}`);
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
        expands,
        controllers,
        registerController,
        frame,
        lines,
        locate,
        row,
        waitFrame,
        fgAt,
        sendKey,
        mouse,
        click,
        width,
    };
}
