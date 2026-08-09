import { beforeEach, describe, expect, it, vi } from "vitest";

import { Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TerminalViewElement } from "../../../../../../tuidom/ui/terminal/terminalViewElement.ts";
import { FakeTerminalSurface } from "../../../../../TestUtils/FakeTerminalSurface.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { PanelComponent } from "../../../browser/parts/panel/panelComponent.ts";
import { PanelService } from "../../../browser/parts/panel/panelService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";
import type { TerminalSessionFactory } from "../common/terminalSessionFactory.ts";

import { TerminalPanelComponent } from "./terminalPanelComponent.ts";
import { TERMINAL_VIEW_ID, TerminalService } from "./terminalService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";

function buildHarness() {
    const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const views = makeViewsHarness();
    const panelService = views.panelService;
    const panelComponent = new PanelComponent(panelService);
    const sessions: FakeTerminalSurface[] = [];
    const factory: TerminalSessionFactory = () => {
        const surface = new FakeTerminalSurface();
        sessions.push(surface);
        return surface;
    };
    const service = new TerminalService(panelService, views.service, factory);
    const focusFallback = { focusEditor: vi.fn() };
    const component = new TerminalPanelComponent(service, views.service, focusFallback);
    const testApp = TestApp.createWithContent(panelComponent.view, new Size(70, 12));
    const dispose = (): void => {
        component.dispose();
        service.dispose();
    };
    return {
        themeService,
        panelService,
        panelComponent,
        /** Виджеты терминала внутри вкладки: тело секции — это активный виджет. */
        widgets: (): TUIElement[] => views.paneView(TERMINAL_VIEW_ID).querySelectorAll("TerminalViewElement"),
        service,
        component,
        testApp,
        created: sessions,
        focusFallback,
        dispose,
    };
}

type Harness = ReturnType<typeof buildHarness>;

describe("TerminalPanelComponent", () => {
    let h: Harness;

    beforeEach(() => {
        h = buildHarness();
    });

    it("keeps the placeholder until the first open (lazy)", () => {
        expect(h.widgets()).toEqual([]);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("No active terminal.");
        h.dispose();
    });

    it("builds a widget for the spawned session and injects it into the panel", () => {
        h.service.openTerminal();
        const content = h.widgets();
        expect(content).toHaveLength(1);
        expect(content[0]).toBeInstanceOf(TerminalViewElement);
        h.dispose();
    });

    it("focuses the terminal widget on open", () => {
        h.service.openTerminal();
        h.testApp.render();
        const widget = h.widgets()[0] as TerminalViewElement;
        expect(widget.isFocused).toBe(true);
        h.dispose();
    });

    it("re-focuses the active widget on focusActive; no-op without terminals", () => {
        // Ни одного инстанса — запрос фокуса не должен падать (activeWidget = null).
        expect(() => {
            h.service.focusActive();
        }).not.toThrow();

        h.service.openTerminal();
        h.testApp.render();
        const widget = h.widgets()[0] as TerminalViewElement;
        widget.blur();
        h.testApp.render();
        expect(widget.isFocused).toBe(false);

        h.service.focusActive();
        h.testApp.render();
        expect(widget.isFocused).toBe(true);
        h.dispose();
    });

    it("disposes the widget and restores the placeholder when the shell exits", () => {
        h.service.openTerminal();
        expect(h.widgets()).toHaveLength(1);
        const disposeSpy = vi.spyOn(TerminalViewElement.prototype, "dispose");

        h.created[0].emitExit(0);

        // Инстанс снят: виджет dispose'нут, контент вкладки снова null → placeholder.
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(h.widgets()).toEqual([]);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("No active terminal.");
        disposeSpy.mockRestore();
        h.dispose();
    });

    it("shows the widget of a newly created second terminal", () => {
        h.service.openTerminal();
        const first = h.widgets()[0];
        h.service.newTerminal();
        const second = h.widgets()[0];
        expect(second).not.toBe(first);
        h.dispose();
    });

    it("falls back to the previous terminal's widget when the active one exits", () => {
        h.service.newTerminal(); // #1
        const firstWidget = h.widgets()[0];
        h.service.newTerminal(); // #2 active

        h.created[1].emitExit(0);

        expect(h.widgets()[0]).toBe(firstWidget);
        h.dispose();
    });

    it("keeps the active widget when a NON-active terminal exits", () => {
        h.service.newTerminal(); // #1
        h.service.newTerminal(); // #2 — активный
        const activeWidget = h.widgets()[0];

        h.created[0].emitExit(0); // выходит НЕактивный #1

        expect(h.widgets()[0]).toBe(activeWidget);
        h.dispose();
    });

    // Регрессия на BUG-3 (#177): после `exit` фокус оставался на снятом с дерева
    // виджете (FocusManager его обнулял) — ввод пропадал целиком.
    it("hands focus to the editor when the last shell exits", () => {
        h.service.openTerminal();
        h.testApp.render();

        h.created[0].emitExit(0);

        expect(h.focusFallback.focusEditor).toHaveBeenCalledTimes(1);
        h.dispose();
    });

    it("hands focus to the remaining terminal when the focused one exits", () => {
        h.service.newTerminal(); // #1
        const firstWidget = h.widgets()[0] as TerminalViewElement;
        h.service.newTerminal(); // #2 — активный и в фокусе
        h.testApp.render();

        h.created[1].emitExit(0);
        h.testApp.render();

        expect(firstWidget.isFocused).toBe(true);
        expect(h.focusFallback.focusEditor).not.toHaveBeenCalled();
        h.dispose();
    });

    it("leaves focus alone when a terminal exits while it was not focused", () => {
        h.service.openTerminal();
        h.testApp.render();
        (h.widgets()[0] as TerminalViewElement).blur();

        h.created[0].emitExit(0);

        expect(h.focusFallback.focusEditor).not.toHaveBeenCalled();
        h.dispose();
    });

    it("spawns, shows and focuses the terminal when its tab is clicked", () => {
        // Клик по табу: контрол зовёт onActivateView → PanelService.activateView →
        // TerminalService лениво спавнит шелл → компонент вкидывает и фокусирует виджет.
        h.panelComponent.view.setActiveView(TERMINAL_VIEW_ID);
        h.panelComponent.view.onActivateView?.(TERMINAL_VIEW_ID);

        const content = h.widgets();
        expect(content).toHaveLength(1);
        expect(content[0]).toBeInstanceOf(TerminalViewElement);
        h.testApp.render();
        expect((content[0] as TerminalViewElement).isFocused).toBe(true);
        h.dispose();
    });

    it("adopts instances created before the component existed", () => {
        const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
        const views = makeViewsHarness();
        const panelComponent = new PanelComponent(views.panelService);
        const service = new TerminalService(views.panelService, views.service, () => new FakeTerminalSurface());
        service.openTerminal(); // инстанс существует ДО компонента

        const component = new TerminalPanelComponent(service, views.service, { focusEditor: vi.fn() });

        expect(views.paneView(TERMINAL_VIEW_ID).querySelectorAll("TerminalViewElement")).toHaveLength(1);
        component.dispose();
        service.dispose();
        panelComponent.dispose();
    });

    it("disposes remaining widgets on component dispose", () => {
        h.service.newTerminal();
        h.service.newTerminal();
        const disposeSpy = vi.spyOn(TerminalViewElement.prototype, "dispose");
        h.component.dispose();
        expect(disposeSpy).toHaveBeenCalledTimes(2);
        disposeSpy.mockRestore();
        h.service.dispose();
    });
});
