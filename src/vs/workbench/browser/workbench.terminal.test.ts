import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { PanelContainerElement } from "@tuidom/elements/panel/panelContainerElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyService, ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import {
    TERMINAL_VIEW_ID,
    TerminalService,
    TerminalServiceDIToken,
} from "../contrib/terminal/browser/terminalService.ts";

const TOGGLE_TERMINAL = "workbench.action.terminal.toggleTerminal";
const NEW_TERMINAL = "workbench.action.terminal.new";

describe("Workbench — integrated terminal", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let contextKeys: ContextKeyService;
    let terminal: TerminalService;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-terminal-" });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        contextKeys = h.container.get(ContextKeyServiceDIToken);
        terminal = h.container.get(TerminalServiceDIToken);
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function panel(): PanelContainerElement {
        return h.workbench.workbenchLayout.getBottomPanel() as PanelContainerElement;
    }

    it("Toggle Terminal shows the panel with TERMINAL active and spawns/focuses a terminal", () => {
        h.commands.execute(TOGGLE_TERMINAL);

        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(panel().getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(terminal.hasOpenTerminals).toBe(true);

        h.testApp.render();
        const screen = h.testApp.backend.screenToString();
        expect(screen).toContain("TERMINAL");

        // Focus landed on the terminal widget → the context keys reflect it.
        expect(contextKeys.get("terminalFocus")).toBe(true);
        expect(contextKeys.get("terminalIsOpen")).toBe(true);
    });

    it("Toggle Terminal again hides the panel", () => {
        h.commands.execute(TOGGLE_TERMINAL); // show
        h.commands.execute(TOGGLE_TERMINAL); // hide (Terminal already visible+active)

        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).not.toContain("TERMINAL");
        // The shell keeps running while the panel is only hidden.
        expect(contextKeys.get("terminalIsOpen")).toBe(true);
    });

    it("terminalIsOpen tracks whether a terminal is open", () => {
        expect(terminal.hasOpenTerminals).toBe(false);
        h.commands.execute(TOGGLE_TERMINAL);
        expect(contextKeys.get("terminalIsOpen")).toBe(true);
    });

    it("Create New Terminal opens a second instance", () => {
        h.commands.execute(TOGGLE_TERMINAL); // first terminal
        // Виджет активного терминала — тело единственной секции вкладки TERMINAL.
        const activeWidget = (): TUIElement => {
            const widgets = panel().querySelectorAll("TerminalViewElement");
            expect(widgets).toHaveLength(1);
            return widgets[0];
        };
        const firstWidget = activeWidget();

        h.commands.execute(NEW_TERMINAL); // second terminal becomes active
        expect(panel().getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(terminal.hasOpenTerminals).toBe(true);
        // Сравниваем булевым выражением, а не `toBe`: провалившийся `toBe` на узле
        // TUI-дерева печатает весь граф и валит воркер по памяти.
        expect(activeWidget() === firstWidget).toBe(false);
    });

    it("Toggle Terminal after the shell exited spawns a new one instead of hiding the panel", () => {
        h.commands.execute(TOGGLE_TERMINAL);
        const session = terminal.getActiveInstance()?.session as FakeTerminalSurface;

        session.emitExit(0); // `exit` в шелле — вкладка остаётся с placeholder'ом
        expect(terminal.hasOpenTerminals).toBe(false);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);

        h.commands.execute(TOGGLE_TERMINAL);

        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(panel().getActiveViewId()).toBe(TERMINAL_VIEW_ID);
        expect(terminal.hasOpenTerminals).toBe(true);
    });

    it("activating the TERMINAL tab lazily spawns a shell", () => {
        expect(terminal.hasOpenTerminals).toBe(false);

        // Simulate a click on the TERMINAL tab: the panel switches the active view,
        // then fires onActivateView (wired by PanelComponent → PanelService.activateView,
        // на котором висит ленивый спавн TerminalService).
        panel().setActiveView(TERMINAL_VIEW_ID);
        panel().onActivateView?.(TERMINAL_VIEW_ID);

        expect(terminal.hasOpenTerminals).toBe(true);
        expect(
            panel()
                .getChildren()
                .filter((c) => !c.hidden),
        ).toHaveLength(1);
    });
});
