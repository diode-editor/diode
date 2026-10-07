import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { EditorElement } from "../../editor/browser/editorElement.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { PROBLEMS_VIEW_ID } from "../contrib/markers/browser/problemsComponent.ts";
import { TerminalPanelComponentDIToken } from "../contrib/terminal/browser/terminalPanelComponent.ts";
import {
    TERMINAL_VIEW_ID,
    type TerminalService,
    TerminalServiceDIToken,
} from "../contrib/terminal/browser/terminalService.ts";
import { LayoutServiceDIToken } from "../services/layout/browser/layoutService.ts";

import { PanelServiceDIToken } from "./parts/panel/panelService.ts";

const NEW = "workbench.action.terminal.new";

/**
 * Команды терминала из состояния «панель спрятана и на другой вкладке, фокус в
 * редакторе»: только так видно, что команда сама показывает TERMINAL, отдаёт
 * фокус терминалу и освежает ключи, а не полагается на то, что это уже сделано.
 */
describe("Workbench — terminal commands from the editor", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;

    function boot(settings: Readonly<Record<string, unknown>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-cmds-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: `${ws.dir}/alpha.txt`,
            focusEditor: true,
            configurationService: createTestConfigurationService(settings),
        });
        terminal = h.container.get(TerminalServiceDIToken);
    }

    /** `n` терминалов, затем панель на PROBLEMS и спрятана — фокус уходит в редактор. */
    function openAndLeave(n: number): void {
        for (let i = 0; i < n; i++) h.commands.execute(NEW);
        h.container.get(PanelServiceDIToken).setActiveView(PROBLEMS_VIEW_ID);
        expect(h.container.get(PanelServiceDIToken).getActiveViewId()).toBe(PROBLEMS_VIEW_ID);
        h.container.get(LayoutServiceDIToken).setPanelVisible(false);
        h.testApp.render();
        expect(h.testApp.focusedElement).toBeInstanceOf(EditorElement);
    }

    const panelShowsTerminal = (): boolean =>
        h.workbench.workbenchLayout.getBottomPanelVisible() &&
        h.container.get(PanelServiceDIToken).getActiveViewId() === TERMINAL_VIEW_ID;
    const activeIndex = (): number => terminal.getInstances().indexOf(terminal.getActiveInstance() as never);
    const keys = () => h.container.get(ContextKeyServiceDIToken);
    const tabsList = () => h.container.get(TerminalPanelComponentDIToken).tabs.list;

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it.each([
        ["workbench.action.terminal.focusNext", 0],
        ["workbench.action.terminal.focusPrevious", 1],
    ])("%s shows TERMINAL and focuses the switched-to terminal", (command, expected) => {
        boot();
        openAndLeave(3);
        h.commands.execute(command);
        h.testApp.render();
        expect(activeIndex()).toBe(expected);
        expect(panelShowsTerminal()).toBe(true);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("Focus Terminal brings TERMINAL back and focuses it", () => {
        boot();
        openAndLeave(1);
        h.commands.execute("workbench.action.terminal.focus");
        h.testApp.render();
        expect(panelShowsTerminal()).toBe(true);
        expect(terminal.getInstances()).toHaveLength(1);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("Focus Terminal Tabs View shows TERMINAL; with the list hidden the terminal gets focus", () => {
        boot();
        openAndLeave(1);
        h.commands.execute("workbench.action.terminal.focusTabs");
        h.testApp.render();
        expect(panelShowsTerminal()).toBe(true);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("Focus Terminal Tabs View with the list visible focuses the list", () => {
        boot();
        openAndLeave(2);
        h.commands.execute("workbench.action.terminal.focusTabs");
        h.testApp.render();
        expect(panelShowsTerminal()).toBe(true);
        expect(h.testApp.focusedElement).toBe(tabsList());
    });

    it("Kill Terminal shows the panel on the remaining terminal and updates terminalCount at once", () => {
        boot();
        openAndLeave(2);
        h.commands.execute("workbench.action.terminal.kill");
        expect(keys().get("terminalCount")).toBe(1);
        h.testApp.render();
        expect(panelShowsTerminal()).toBe(true);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("Kill Terminal of the last one clears terminalIsOpen while focus stays in the editor", () => {
        boot();
        openAndLeave(1);
        h.commands.execute("workbench.action.terminal.kill");
        expect(keys().get("terminalIsOpen")).toBe(false);
        expect(h.testApp.focusedElement).toBeInstanceOf(EditorElement);
    });

    it("Kill All Terminals clears terminalIsOpen at once", () => {
        boot();
        openAndLeave(2);
        h.commands.execute("workbench.action.terminal.killAll");
        expect(keys().get("terminalIsOpen")).toBe(false);
    });

    it("Delete in the tabs list updates terminalCount at once and keeps focus in the list", () => {
        boot();
        for (let i = 0; i < 3; i++) h.commands.execute(NEW);
        h.commands.execute("workbench.action.terminal.focusTabs");
        h.testApp.render();
        h.testApp.sendKey("Delete");
        expect(keys().get("terminalCount")).toBe(2);
        expect(h.testApp.focusedElement).toBe(tabsList());
    });

    it("Kill Terminal from the tab menu with the list hidden afterwards puts focus into the remaining terminal", () => {
        boot();
        openAndLeave(2);
        const [first] = terminal.getInstances();
        h.commands.execute("workbench.action.terminal.killActiveTab", first.id);
        h.testApp.render();
        expect(terminal.getInstances()).toHaveLength(1);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("Switch Terminal `N: title` shows TERMINAL and focuses it; an unknown label leaves the panel hidden", async () => {
        boot();
        openAndLeave(2);
        await h.commands.execute("workbench.action.terminal.switchTerminal", "─");
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
        expect(activeIndex()).toBe(1);

        await h.commands.execute("workbench.action.terminal.switchTerminal", "1: bash");
        h.testApp.render();
        expect(activeIndex()).toBe(0);
        expect(panelShowsTerminal()).toBe(true);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("Switch Active Terminal shows its placeholder, opens on the active one and focuses the pick", async () => {
        boot();
        openAndLeave(3);
        const picked = h.commands.execute("workbench.action.quickOpenTerm") as Promise<void>;
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Type the name of a terminal to open.");
        // Пикер открыт на активном (#3): Enter его же и выбирает.
        h.testApp.sendKey("Enter");
        await picked;
        h.testApp.render();
        expect(activeIndex()).toBe(2);
        expect(panelShowsTerminal()).toBe(true);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });
});
