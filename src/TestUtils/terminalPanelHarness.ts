import { Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { vi } from "vitest";

import { codicon, iconGlyph } from "../vs/base/common/codicons.ts";
import { CommandRegistry } from "../vs/platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../vs/platform/contextview/browser/contextMenuService.ts";
import type { IContextMenuMenuDelegate } from "../vs/platform/contextview/common/contextMenuDelegate.ts";
import type { IProductIconService } from "../vs/platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { PanelComponent } from "../vs/workbench/browser/parts/panel/panelComponent.ts";
import { makeViewsHarness } from "../vs/workbench/browser/parts/views/viewsService.testUtils.ts";
import { makeTerminalColors } from "../vs/workbench/contrib/terminal/browser/terminalColorsService.testUtils.ts";
import { TerminalPanelComponent } from "../vs/workbench/contrib/terminal/browser/terminalPanelComponent.ts";
import { TerminalService } from "../vs/workbench/contrib/terminal/browser/terminalService.ts";
import { terminalTabRowId } from "../vs/workbench/contrib/terminal/browser/terminalTabsList.ts";
import { createPlainTerminalWidget } from "../vs/workbench/contrib/terminal/browser/terminalWidgetFactory.ts";
import { darkPlusTheme } from "../vs/workbench/services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../vs/workbench/services/themes/common/themeService.ts";

import { FakeTerminalSurface } from "./FakeTerminalSurface.ts";
import { TestApp } from "./TestApp.ts";
import { createTestConfigurationService } from "./testConfigurationService.ts";

export const WIDTH = 80;
const HEIGHT = 12;

export function buildHarness(
    settings: Readonly<Record<string, unknown>> = {},
    shells: readonly string[] = [],
    icons?: IProductIconService,
    /** Seeds the state store before the component reads it. */
    stored: Readonly<Record<string, unknown>> = {},
) {
    const views = makeViewsHarness();
    for (const [key, value] of Object.entries(stored)) views.stored.set(key, value);
    const panelComponent = new PanelComponent(views.panelService, new CommandRegistry());
    const configuration = createTestConfigurationService(settings);
    const sessions: FakeTerminalSurface[] = [];
    const service = new TerminalService(views.service, configuration, () => {
        const surface = new FakeTerminalSurface(shells[sessions.length] ?? "/bin/bash");
        sessions.push(surface);
        return surface;
    });
    views.service.attachRegisteredContainers();
    const menus: IContextMenuMenuDelegate[] = [];
    const contextMenu = {
        showContextMenu: (delegate: IContextMenuMenuDelegate) => {
            menus.push(delegate);
        },
    } as unknown as ContextMenuService;
    const commands = new CommandRegistry();
    const focusFallback = { focusEditor: vi.fn() };
    const component = new TerminalPanelComponent(
        service,
        views.service,
        focusFallback,
        configuration,
        contextMenu,
        commands,
        makeTerminalColors(new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)), configuration).colors,
        createPlainTerminalWidget,
        views.state,
        icons,
    );
    const testApp = TestApp.createWithContent(panelComponent.view, new Size(WIDTH, HEIGHT));
    const screen = (): string => {
        testApp.render();
        return testApp.backend.screenToString();
    };
    const lines = (): string[] => screen().split("\n");
    const rowOf = (instanceIndex: number) => {
        const id = service.getInstances()[instanceIndex].id;
        return component.tabs.list.querySelectorAll(`#${terminalTabRowId(id)}`)[0];
    };
    /** Frame coordinates are 0-based. */
    const mouse = (button: MouseToken["button"], x: number, y: number, action: MouseToken["action"]): void => {
        testApp.backend.simulateMouse({
            kind: "mouse",
            button,
            action,
            x: x + 1,
            y: y + 1,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
    };
    /** Frame coordinates are 0-based. */
    const clickRow = (instanceIndex: number, button: MouseToken["button"] = "left"): void => {
        screen();
        const pos = rowOf(instanceIndex).globalPosition;
        mouse(button, pos.x + 2, pos.y, "press");
        mouse(button, pos.x + 2, pos.y, "release");
    };
    const activeIndex = (): number => service.getInstances().indexOf(service.getActiveInstance() as never);
    const dispose = (): void => {
        component.dispose();
        service.dispose();
    };
    return {
        views,
        configuration,
        service,
        component,
        testApp,
        sessions,
        focusFallback,
        menus,
        commands,
        screen,
        lines,
        rowOf,
        clickRow,
        mouse,
        activeIndex,
        dispose,
    };
}

export function tab(title: string): string {
    return `│ ${iconGlyph(codicon("terminal"), true)} ${title}`;
}

export function count(text: string, needle: string): number {
    return text.split("\n").filter((line) => line.includes(needle)).length;
}
