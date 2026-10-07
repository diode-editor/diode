import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { MenuId } from "../../platform/actions/common/menuId.ts";
import { MenuRegistryDIToken } from "../../platform/actions/common/menuRegistry.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import {
    type TerminalPanelComponent,
    TerminalPanelComponentDIToken,
} from "../contrib/terminal/browser/terminalPanelComponent.ts";
import {
    TERMINAL_VIEW_ID,
    type TerminalService,
    TerminalServiceDIToken,
} from "../contrib/terminal/browser/terminalService.ts";

const NEW = "workbench.action.terminal.new";

describe("Workbench — multiple terminals", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let terminal: TerminalService;
    let component: TerminalPanelComponent;

    function boot(settings: Readonly<Record<string, unknown>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-terminal-tabs-" });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            configurationService: createTestConfigurationService(settings),
        });
        terminal = h.container.get(TerminalServiceDIToken);
        component = h.container.get(TerminalPanelComponentDIToken);
    }

    /** Открыть `n` терминалов командой New (последний — активный и в фокусе). */
    function open(n: number): void {
        for (let i = 0; i < n; i++) h.commands.execute(NEW);
        h.testApp.render();
    }

    const activeIndex = (): number => terminal.getInstances().indexOf(terminal.getActiveInstance() as never);
    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("Create New Terminal twice shows the tabs list with both shells in the frame", () => {
        boot();
        open(1);
        expect(component.tabsVisible).toBe(false);
        open(1);
        expect(component.tabsVisible).toBe(true);
        expect(
            screen()
                .split("\n")
                .filter((line) => line.includes("│ ") && line.includes(" bash")),
        ).toHaveLength(2);
    });

    it("Ctrl+PageDown / Ctrl+PageUp cycle the active terminal while one is focused", () => {
        boot();
        open(3);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);

        h.testApp.sendKey("Ctrl+PageDown");
        expect(activeIndex()).toBe(0);
        // Фокус переехал в новый активный терминал — следующее нажатие тоже работает.
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        h.testApp.sendKey("Ctrl+PageDown");
        expect(activeIndex()).toBe(1);
        h.testApp.sendKey("Ctrl+PageUp");
        expect(activeIndex()).toBe(0);
    });

    it("Kill Terminal kills the active one and keeps the panel on the next", () => {
        boot();
        open(2);
        const [first] = terminal.getInstances();

        h.commands.execute("workbench.action.terminal.kill");

        expect(terminal.getInstances()).toEqual([first]);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        expect(component.tabsVisible).toBe(false);
    });

    it("Kill Terminal on the last terminal hides the panel", () => {
        boot();
        open(1);
        h.commands.execute("workbench.action.terminal.kill");
        expect(terminal.hasOpenTerminals).toBe(false);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
    });

    it("Kill Terminal without terminals does nothing", () => {
        boot();
        expect(() => h.commands.execute("workbench.action.terminal.kill")).not.toThrow();
        expect(terminal.hasOpenTerminals).toBe(false);
    });

    it("Focus Terminal Tabs View puts focus into the list; Delete there kills the row under the cursor", () => {
        boot();
        open(3);
        const keys = h.container.get(ContextKeyServiceDIToken);
        h.commands.execute("workbench.action.terminal.focusTabs");
        h.testApp.render();
        expect(h.testApp.focusedElement).toBe(component.tabs.list);
        expect(keys.get("terminalTabsFocus")).toBe(true);

        h.testApp.sendKey("ArrowUp"); // курсор на #2 — он и активный
        const victim = terminal.getInstances()[1];
        h.testApp.sendKey("Delete");

        expect(terminal.getInstances().includes(victim)).toBe(false);
        expect(terminal.getInstances()).toHaveLength(2);
        // Список остался — фокус в нём (как `focusTabs()` эталона после kill).
        expect(h.testApp.focusedElement).toBe(component.tabs.list);

        h.testApp.sendKey("Delete");
        // Остался один — список спрятан, фокус в терминал.
        expect(terminal.getInstances()).toHaveLength(1);
        h.testApp.render();
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("Focus Terminal Tabs View is a no-op while the list is hidden", () => {
        boot();
        open(1);
        h.commands.execute("workbench.action.terminal.focusTabs");
        h.testApp.render();
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("killActiveTab from the tab context menu kills the terminal it was opened for", () => {
        boot();
        open(2);
        const [first, second] = terminal.getInstances();
        const entries = h.container.get(MenuRegistryDIToken).getMenuItems(MenuId.TerminalTabContext, {
            instanceId: first.id,
        });
        const kill = entries.find((e) => e.type !== "separator" && "label" in e && e.label === "Kill Terminal");
        expect(kill).toBeDefined();
        (kill as { onSelect?: () => void }).onSelect?.();
        expect(terminal.getInstances()).toEqual([second]);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("killActiveTab without a cursor row does nothing", () => {
        boot();
        expect(() => h.commands.execute("workbench.action.terminal.killActiveTab")).not.toThrow();
    });

    it("Kill All Terminals closes every shell and hides the panel", () => {
        boot();
        open(3);
        const sessions = terminal.getInstances().map((i) => i.session as FakeTerminalSurface);
        h.commands.execute("workbench.action.terminal.killAll");
        expect(terminal.hasOpenTerminals).toBe(false);
        expect(sessions.every((s) => s.disposed)).toBe(true);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
    });

    it("Switch Terminal with `N: title` activates the N-th terminal and focuses it", async () => {
        boot();
        open(3);
        await h.commands.execute("workbench.action.terminal.switchTerminal", "1: bash");
        expect(activeIndex()).toBe(0);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
        // Чужая строка — no-op.
        await h.commands.execute("workbench.action.terminal.switchTerminal", "─");
        expect(activeIndex()).toBe(0);
    });

    it("Switch Terminal with Show Tabs turns the tabs list back on", async () => {
        boot({ "terminal.integrated.tabs.enabled": false });
        open(2);
        expect(component.tabsVisible).toBe(false);
        await h.commands.execute("workbench.action.terminal.switchTerminal", "Show Tabs");
        expect(h.container.get(IConfigurationServiceDIToken).get("terminal.integrated.tabs.enabled")).toBe(true);
        expect(component.tabsVisible).toBe(true);
    });

    it("Switch Active Terminal picks a terminal from a quick pick", async () => {
        boot();
        open(3);
        const picked = h.commands.execute("workbench.action.quickOpenTerm") as Promise<void>;
        h.testApp.render();
        const frame = screen();
        expect(frame).toContain("1: bash");
        expect(frame).toContain("3: bash");
        expect(frame).toContain("Create New Terminal");
        // Пикер открыт на активном (#3) — вверх на #2.
        h.testApp.sendKey("ArrowUp");
        h.testApp.sendKey("Enter");
        await picked;
        expect(activeIndex()).toBe(1);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
    });

    it("Switch Active Terminal → Create New Terminal opens another shell", async () => {
        boot();
        open(1);
        const picked = h.commands.execute("workbench.action.terminal.switchTerminal") as Promise<void>;
        h.testApp.render();
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        await picked;
        expect(terminal.getInstances()).toHaveLength(2);
        expect(activeIndex()).toBe(1);
    });

    it("Switch Active Terminal dismissed keeps everything as is", async () => {
        boot();
        open(2);
        const picked = h.commands.execute("workbench.action.quickOpenTerm") as Promise<void>;
        h.testApp.render();
        h.testApp.sendKey("Escape");
        await picked;
        expect(activeIndex()).toBe(1);
        expect(terminal.getInstances()).toHaveLength(2);
    });

    it("Focus Terminal shows the panel and spawns a terminal when none is open", () => {
        boot();
        h.commands.execute("workbench.action.terminal.focus");
        h.testApp.render();
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        expect(terminal.hasOpenTerminals).toBe(true);
        expect(h.testApp.focusedElement).toBeInstanceOf(TerminalViewElement);
    });

    it("New and Kill sit as buttons in the TERMINAL tab title", () => {
        boot();
        open(1);
        const entries = h.container
            .get(MenuRegistryDIToken)
            .getMenuItems(MenuId.ViewTitle, { view: TERMINAL_VIEW_ID })
            .filter((e) => e.type !== "separator")
            .map((e) => ("id" in e ? e.id : undefined));
        expect(entries).toEqual(["workbench.action.terminal.new", "workbench.action.terminal.kill"]);
    });
});
