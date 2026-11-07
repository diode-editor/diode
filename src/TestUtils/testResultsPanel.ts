import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { vi } from "vitest";

import { Emitter } from "../vs/base/common/event.ts";
import type { IConfigurationService } from "../vs/platform/configuration/common/iConfigurationService.ts";
import type { ProgressService } from "../vs/platform/progress/common/progressService.ts";
import { bindWidgetGlyphs } from "../vs/platform/theme/browser/widgetGlyphs.ts";
import { type IProductIconService, StaticProductIconService } from "../vs/platform/theme/common/productIconService.ts";
import type { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import type { IViewsHarness } from "../vs/workbench/browser/parts/views/viewsService.testUtils.ts";
import {
    resolveTerminalColors,
    type TerminalColorsService,
} from "../vs/workbench/contrib/terminal/browser/terminalColorsService.ts";
import { ExtensionPtySession } from "../vs/workbench/contrib/terminal/node/extensionPtySession.ts";
import {
    TEST_RESULTS_CONTAINER_ID,
    TestResultsComponent,
} from "../vs/workbench/contrib/testing/browser/testResultsView.ts";
import type { TestResultService } from "../vs/workbench/contrib/testing/common/testResultService.ts";

import { TestApp } from "./TestApp.ts";

export interface IResultsPanelOptions {
    readonly results: TestResultService;
    readonly views: IViewsHarness;
    readonly theme: WorkbenchTheme;
    readonly configuration: IConfigurationService;
    readonly progress: ProgressService;
    readonly icons?: IProductIconService;
    readonly width?: number;
    readonly height?: number;
}

/**
 * The TEST RESULTS component over the views harness, its output in a real emulator, and its container's body as the
 * panel shows it.
 */
export function createResultsPanel(options: IResultsPanelOptions) {
    const { views } = options;
    const icons = options.icons ?? new StaticProductIconService(false);
    const colors = { colors: resolveTerminalColors(options.theme, undefined), onDidChange: new Emitter<never>().event };
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
