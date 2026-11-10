import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IContextMenuMenuDelegate } from "../../../../platform/contextview/common/contextMenuDelegate.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { PanelComponent } from "../../../browser/parts/panel/panelComponent.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { makeTerminalColors } from "./terminalColorsService.testUtils.ts";
import { TerminalPanelComponent } from "./terminalPanelComponent.ts";
import { TerminalService } from "./terminalService.ts";
import { terminalTabRowId } from "./terminalTabsList.ts";
import { createPlainTerminalWidget } from "./terminalWidgetFactory.ts";

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
        const row = component.tabs.list.querySelector(`#${terminalTabRowId(id)}`);
        if (row === null) throw new Error("row not rendered");
        return row;
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
    return `│ ${CODICON_GLYPHS.terminal ?? ""} ${title}`;
}

export function count(text: string, needle: string): number {
    return text.split("\n").filter((line) => line.includes(needle)).length;
}
