import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import type { SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { describe, expect, it, vi } from "vitest";

import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IContextMenuMenuDelegate } from "../../../../platform/contextview/common/contextMenuDelegate.ts";
import { PanelComponent } from "../../../browser/parts/panel/panelComponent.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";

import {
    SWITCH_TERMINAL_COMMAND_ID,
    TERMINAL_ACTIVE_TAB_ID,
    TerminalPanelComponent,
} from "./terminalPanelComponent.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";
import { SWITCH_TERMINAL_SHOW_TABS, TERMINAL_TABS_WIDTH, terminalTabRowId } from "./terminalTabsList.ts";

const WIDTH = 80;
const HEIGHT = 12;

/** Компонент поверх настоящей панели и TestApp — тесты смотрят в кадр. */
function buildHarness(settings: Readonly<Record<string, unknown>> = {}, shells: readonly string[] = []) {
    const views = makeViewsHarness();
    const panelComponent = new PanelComponent(views.panelService, new CommandRegistry());
    const configuration = createTestConfigurationService(settings);
    const sessions: FakeTerminalSurface[] = [];
    const service = new TerminalService(views.panelService, views.service, configuration, () => {
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
    );
    const testApp = TestApp.createWithContent(panelComponent.view, new Size(WIDTH, HEIGHT));
    const screen = (): string => {
        testApp.render();
        return testApp.backend.screenToString();
    };
    /** Строки кадра, где виден заголовок вкладки (имя терминала/табы). */
    const lines = (): string[] => screen().split("\n");
    const rowOf = (instanceIndex: number) => {
        const id = service.getInstances()[instanceIndex].id;
        const row = component.tabs.list.querySelector(`#${terminalTabRowId(id)}`);
        if (row === null) throw new Error("row not rendered");
        return row;
    };
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
    /** Клик по строке списка (координаты кадра 0-based). */
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
        activeIndex,
        dispose,
    };
}

/** Строка списка в кадре: разделитель, отступ, глиф `$(terminal)` и имя. */
function tab(title: string): string {
    return `│ ${CODICON_GLYPHS.terminal ?? ""} ${title}`;
}

/** Сколько строк кадра содержат подстроку. */
function count(text: string, needle: string): number {
    return text.split("\n").filter((line) => line.includes(needle)).length;
}

describe("TerminalPanelComponent — tabs list in the frame", () => {
    it("hides the list for a single terminal and shows its name in the view title instead", () => {
        const h = buildHarness({}, ["/bin/bash"]);
        h.service.openTerminal();
        const screen = h.screen();
        // Имя активного — в строке табов панели, рядом с TERMINAL.
        const tabRow = h.lines().find((line) => line.includes("TERMINAL")) ?? "";
        expect(tabRow).toContain("bash");
        expect(h.component.tabsVisible).toBe(false);
        expect(screen).not.toContain(tab("bash"));
        h.dispose();
    });

    it("shows every terminal as a row of the list on the right once there are two", () => {
        const h = buildHarness({}, ["/bin/bash", "/usr/bin/zsh"]);
        h.service.newTerminal();
        h.service.newTerminal();
        const screen = h.screen();

        expect(h.component.tabsVisible).toBe(true);
        expect(count(screen, tab("bash"))).toBe(1);
        expect(count(screen, tab("zsh"))).toBe(1);
        // Справа: строка списка начинается за разделителем в правой части кадра.
        const bashRow = h.lines().find((line) => line.includes(tab("bash"))) ?? "";
        expect(bashRow.indexOf(tab("bash"))).toBe(WIDTH - TERMINAL_TABS_WIDTH - 1);
        // Имени активного в заголовке больше нет — его роль играет список.
        const tabRow = h.lines().find((line) => line.includes("TERMINAL")) ?? "";
        expect(tabRow).not.toContain("zsh");
        h.dispose();
    });

    it("highlights the active terminal's row", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        const list = h.component.tabs.list;
        const highlight = list.styleVar("list.inactiveSelectionBackground");
        const bgOf = (index: number): number => {
            const pos = h.rowOf(index).globalPosition;
            return h.testApp.backend.getBgAt(new Point(pos.x + 2, pos.y));
        };
        expect(bgOf(1)).toBe(highlight);
        expect(bgOf(0)).not.toBe(highlight);

        h.service.setActiveInstanceByIndex(0);
        h.screen();
        expect(bgOf(0)).toBe(highlight);
        expect(bgOf(1)).not.toBe(highlight);
        h.dispose();
    });

    it("swaps the visible terminal when another one becomes active", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        const visible = (): TerminalViewElement[] =>
            h.views.paneView(TERMINAL_VIEW_ID).querySelectorAll("TerminalViewElement") as TerminalViewElement[];
        const second = visible()[0];
        h.service.setActiveInstanceByIndex(0);
        expect(visible()).toHaveLength(1);
        expect(visible()[0] === second).toBe(false);
        h.dispose();
    });

    it("puts the list on the left with tabs.location: left", () => {
        const h = buildHarness({ "terminal.integrated.tabs.location": "left" });
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        expect(h.component.tabs.list.globalPosition.x).toBe(h.component.view.globalPosition.x);
        // Разделитель сразу за списком.
        const row = h.lines()[h.rowOf(0).globalPosition.y];
        expect(row[h.component.view.globalPosition.x + TERMINAL_TABS_WIDTH]).toBe("│");
        h.dispose();
    });

    it("shows the list even for one terminal with hideCondition: never", () => {
        const h = buildHarness({ "terminal.integrated.tabs.hideCondition": "never" });
        h.service.openTerminal();
        expect(count(h.screen(), tab("bash"))).toBe(1);
        h.dispose();
    });

    it("treats hideCondition: singleGroup like singleTerminal (a group is one terminal here)", () => {
        const h = buildHarness({ "terminal.integrated.tabs.hideCondition": "singleGroup" });
        h.service.openTerminal();
        expect(h.component.tabsVisible).toBe(false);
        h.service.newTerminal();
        expect(h.component.tabsVisible).toBe(true);
        h.dispose();
    });

    it("hides the list again when the second terminal goes away", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        expect(h.component.tabsVisible).toBe(true);
        h.service.closeInstance(h.service.getInstances()[0].id);
        expect(h.component.tabsVisible).toBe(false);
        expect(h.screen()).not.toContain(tab("bash"));
        h.dispose();
    });

    it("re-applies settings live", async () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        expect(h.component.tabsVisible).toBe(true);
        await h.configuration.updateValue("terminal.integrated.tabs.enabled", false);
        expect(h.component.tabsVisible).toBe(false);
        await h.configuration.updateValue("terminal.integrated.tabs.enabled", true);
        await h.configuration.updateValue("terminal.integrated.tabs.location", "left");
        h.screen();
        expect(h.component.tabs.list.globalPosition.x).toBe(h.component.view.globalPosition.x);
        h.dispose();
    });

    it("ignores unrelated configuration changes", async () => {
        const h = buildHarness();
        h.service.newTerminal();
        const spy = vi.spyOn(h.views.service, "setViewTitleWidget");
        await h.configuration.updateValue("editor.tabSize", 7);
        expect(spy).not.toHaveBeenCalled();
        h.dispose();
    });
});

describe("TerminalPanelComponent — active terminal in the view title", () => {
    it("shows nothing in the title without terminals", () => {
        const h = buildHarness();
        const tabRow = h.lines().find((line) => line.includes("TERMINAL")) ?? "";
        expect(tabRow).not.toContain("bash");
        h.dispose();
    });

    it("showActiveTerminal: always keeps the name next to the list", () => {
        const h = buildHarness({ "terminal.integrated.tabs.showActiveTerminal": "always" }, ["/bin/bash", "/bin/fish"]);
        h.service.newTerminal();
        h.service.newTerminal();
        const tabRow = h.lines().find((line) => line.includes("TERMINAL")) ?? "";
        expect(tabRow).toContain("fish");
        expect(h.component.tabsVisible).toBe(true);
        h.dispose();
    });

    it("showActiveTerminal: never shows no name even for a single terminal", () => {
        const h = buildHarness({ "terminal.integrated.tabs.showActiveTerminal": "never" });
        h.service.openTerminal();
        const tabRow = h.lines().find((line) => line.includes("TERMINAL")) ?? "";
        expect(tabRow).not.toContain("bash");
        h.dispose();
    });

    it("showActiveTerminal: singleTerminal shows the name only while there is one", () => {
        const h = buildHarness({ "terminal.integrated.tabs.showActiveTerminal": "singleTerminal" });
        h.service.openTerminal();
        expect(h.lines().find((line) => line.includes("TERMINAL"))).toContain("bash");
        h.service.newTerminal();
        expect(h.lines().find((line) => line.includes("TERMINAL"))).not.toContain("bash");
        h.dispose();
    });

    it("draws the name in descriptionForeground", () => {
        const h = buildHarness();
        h.service.openTerminal();
        h.screen();
        const label = h.testApp.querySelector(`#${TERMINAL_ACTIVE_TAB_ID}`);
        if (label === null) throw new Error("active tab label not rendered");
        const pos = label.globalPosition;
        expect(h.testApp.backend.getFgAt(new Point(pos.x + 3, pos.y))).toBe(label.styleVar("descriptionForeground"));
        h.dispose();
    });

    it("a click on the name opens the tab context menu for the active terminal", () => {
        const h = buildHarness();
        h.service.openTerminal();
        h.screen();
        const label = h.testApp.querySelector(`#${TERMINAL_ACTIVE_TAB_ID}`);
        if (label === null) throw new Error("active tab label not rendered");
        const pos = label.globalPosition;
        h.testApp.backend.simulateMouse(clickToken(pos.x + 2, pos.y, "press"));
        h.testApp.backend.simulateMouse(clickToken(pos.x + 2, pos.y, "release"));

        expect(h.menus).toHaveLength(1);
        expect(h.menus[0].menuId).toBe(MenuId.TerminalTabContext);
        expect(h.menus[0].menuContext).toEqual({ instanceId: h.service.getInstances()[0].id });
        expect(h.menus[0].getOwner()).toBe(h.component.view);
        expect(h.menus[0].getAnchor()).toEqual({ screenX: pos.x + 2, screenY: pos.y + 1 });
        h.dispose();
    });
});

function clickToken(x: number, y: number, action: MouseToken["action"]): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        action,
        x: x + 1,
        y: y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

describe("TerminalPanelComponent — tabs.enabled: false (dropdown)", () => {
    it("puts a dropdown of `N: title` items plus Show Tabs into the title instead of the list", () => {
        const h = buildHarness({ "terminal.integrated.tabs.enabled": false }, ["/bin/bash", "/usr/bin/zsh"]);
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        expect(h.component.tabsVisible).toBe(false);
        const switcher = h.testApp.querySelector("#terminalSwitcher") as SelectBoxElement | null;
        if (switcher === null) throw new Error("switcher not rendered");
        expect(switcher.inspectState()).toMatchObject({
            options: ["1: bash", "2: zsh", "─", "Show Tabs"],
            selectedIndex: 1,
        });
        const tabRow = h.lines().find((line) => line.includes("TERMINAL")) ?? "";
        expect(tabRow).toContain("2: zsh");
        h.dispose();
    });

    it("selecting an item runs workbench.action.terminal.switchTerminal with its label", () => {
        const h = buildHarness({ "terminal.integrated.tabs.enabled": false });
        const run = vi.fn();
        h.commands.register(SWITCH_TERMINAL_COMMAND_ID, run);
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        const switcher = h.testApp.querySelector("#terminalSwitcher") as SelectBoxElement;
        switcher.onDidSelect?.({ selected: "1: bash", index: 0 });
        expect(run).toHaveBeenCalledWith("1: bash");
        h.dispose();
    });
});

describe("TerminalPanelComponent — dropdown keyboard", () => {
    it("skips the separator: two steps down from the first terminal land on Show Tabs", () => {
        const h = buildHarness({ "terminal.integrated.tabs.enabled": false });
        const run = vi.fn();
        h.commands.register(SWITCH_TERMINAL_COMMAND_ID, run);
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        const switcher = h.testApp.querySelector("#terminalSwitcher");
        if (switcher === null) throw new Error("switcher not rendered");
        switcher.focus();
        h.testApp.render();
        h.testApp.sendKey("Enter"); // раскрыть
        expect((switcher as SelectBoxElement).isOpen()).toBe(true);
        // Попап открывается на первом пункте: «1: bash» → «2: bash» → (черта пропущена) «Show Tabs».
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        expect(run).toHaveBeenCalledWith(SWITCH_TERMINAL_SHOW_TABS);
        h.dispose();
    });
});

describe("TerminalPanelComponent — list interaction", () => {
    it("a click on a row makes its terminal active without stealing focus (focusMode: doubleClick)", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        const onFocus = vi.fn();
        h.service.onDidRequestFocus(onFocus);

        h.clickRow(0);

        expect(h.activeIndex()).toBe(0);
        expect(onFocus).not.toHaveBeenCalled();
        h.dispose();
    });

    it("a click also focuses the terminal with focusMode: singleClick", () => {
        const h = buildHarness({ "terminal.integrated.tabs.focusMode": "singleClick" });
        h.service.newTerminal();
        h.service.newTerminal();

        h.clickRow(0);
        h.testApp.render();

        expect(h.activeIndex()).toBe(0);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        h.dispose();
    });

    it("arrows move the active terminal while focus stays in the list; Enter focuses the terminal", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        h.component.focusTabs();
        h.testApp.render();
        expect(h.testApp.focusedElement).toBe(h.component.tabs.list);

        h.testApp.sendKey("ArrowUp");
        expect(h.activeIndex()).toBe(1);
        expect(h.testApp.focusedElement).toBe(h.component.tabs.list);
        h.testApp.sendKey("ArrowUp");
        expect(h.activeIndex()).toBe(0);

        h.testApp.sendKey("Enter");
        h.testApp.render();
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        expect(h.activeIndex()).toBe(0);
        h.dispose();
    });

    it("double click activates and focuses the terminal", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        h.clickRow(0);
        h.clickRow(0);
        h.testApp.render();
        expect(h.activeIndex()).toBe(0);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        h.dispose();
    });

    it("a right click opens TerminalTabContext for the row under the cursor", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        h.clickRow(0, "right");
        expect(h.menus).toHaveLength(1);
        expect(h.menus[0].menuId).toBe(MenuId.TerminalTabContext);
        expect(h.menus[0].menuContext).toEqual({ instanceId: h.service.getInstances()[0].id });
        h.dispose();
    });

    it("rebuilding the list does not echo back into setActiveInstance", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        const spy = vi.spyOn(h.service, "setActiveInstance");
        h.service.newTerminal();
        h.service.setActiveToPrevious();
        expect(spy).toHaveBeenCalledTimes(1); // только явный вызов из setActiveToPrevious
        h.dispose();
    });

    it("getCursorInstanceId follows the active terminal", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        expect(h.component.tabs.getCursorInstanceId()).toBe(h.service.getInstances()[1].id);
        h.service.setActiveInstanceByIndex(0);
        expect(h.component.tabs.getCursorInstanceId()).toBe(h.service.getInstances()[0].id);
        h.dispose();
    });
});

describe("TerminalPanelComponent — focus and context keys", () => {
    it("focusTabs focuses the terminal while the list is hidden (showPanel(true) of the reference)", () => {
        const h = buildHarness();
        h.service.openTerminal();
        h.testApp.render();
        const widget = h.testApp.focusedElement as TerminalViewElement;
        widget.blur();
        h.testApp.render();

        h.component.focusTabs();
        h.testApp.render();

        expect(h.testApp.focusedElement).toBe(widget);
        h.dispose();
    });

    it("hands focus to the editor when the focused list disappears with no terminals left", () => {
        const h = buildHarness({ "terminal.integrated.hideOnLastClosed": false });
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        h.component.focusTabs();
        h.testApp.render();

        for (const instance of [...h.service.getInstances()]) h.service.closeInstance(instance.id);

        expect(h.focusFallback.focusEditor).toHaveBeenCalled();
        h.dispose();
    });

    it("typing in the list does not jump between terminals (no typeahead)", () => {
        const h = buildHarness({}, ["/bin/bash", "/usr/bin/zsh", "/bin/fish"]);
        h.service.newTerminal();
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        h.component.focusTabs();
        h.testApp.render();
        h.testApp.sendKey("z"); // с typeahead курсор прыгнул бы на zsh
        expect(h.activeIndex()).toBe(2);
        h.dispose();
    });

    it("terminalTabsFocus is true only while the list holds focus", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        const keys = new ContextKeyService();
        h.component.updateContextKeys(keys, h.testApp.focusedElement);
        expect(keys.get("terminalTabsFocus")).toBe(false);
        h.component.focusTabs();
        h.testApp.render();
        h.component.updateContextKeys(keys, h.testApp.focusedElement);
        expect(keys.get("terminalTabsFocus")).toBe(true);
        h.component.updateContextKeys(keys, null);
        expect(keys.get("terminalTabsFocus")).toBe(false);
        h.dispose();
    });

    it("hands focus to the terminal when the focused list disappears", () => {
        const h = buildHarness();
        h.service.newTerminal();
        h.service.newTerminal();
        h.screen();
        h.component.focusTabs();
        h.testApp.render();

        h.service.closeInstance(h.service.getInstances()[0].id);
        h.testApp.render();

        expect(h.component.tabsVisible).toBe(false);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        h.dispose();
    });
});
