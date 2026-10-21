import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import { loadState, type StateService } from "../../platform/state/node/stateService.ts";
import { TERMINAL_VIEW_ID, TerminalServiceDIToken } from "../contrib/terminal/browser/terminalService.ts";
import { TerminalSessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";

import { AuxiliaryBarServiceDIToken } from "./parts/auxiliarybar/auxiliaryBarService.ts";
import type { PanelContainerElement } from "./parts/panel/panelContainerElement.ts";
import { PanelServiceDIToken } from "./parts/panel/panelService.ts";
import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

const SIZE = new Size(120, 24);
const TOGGLE_TERMINAL = "workbench.action.terminal.toggleTerminal";

describe("Workbench — terminal in the secondary side bar", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let writers: StateService[];
    let sessions: FakeTerminalSurface[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-auxterm-ws-" });
        userData = createTempWorkspace({ prefix: "diode-auxterm-home-" });
        writers = [];
        sessions = [];
    });

    afterEach(() => {
        for (const writer of writers) writer.dispose();
        ws.dispose();
        userData.dispose();
    });

    function launch(settings: Readonly<Record<string, unknown>> = {}): { h: IAppHarness; state: StateService } {
        const state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
        writers.push(state);
        const h = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state,
            size: SIZE,
            configurationService: createTestConfigurationService(settings),
            containerOverrides: (container) => {
                container.bind(TerminalSessionFactoryDIToken, () => () => {
                    const surface = new FakeTerminalSurface();
                    surface.setGrid(["$ ready"]);
                    sessions.push(surface);
                    return surface;
                });
            },
        });
        return { h, state };
    }

    function moveTerminalRight(h: IAppHarness): void {
        h.container.get(ViewsServiceDIToken).moveViewToLocation(TERMINAL_VIEW_ID, "auxiliarybar");
    }

    function part(h: IAppHarness): PanelContainerElement {
        return h.workbench.workbenchLayout.getRightPanel() as PanelContainerElement;
    }

    function keys(h: IAppHarness) {
        h.container.get(WorkbenchContextKeysDIToken).update();
        return h.container.get(ContextKeyServiceDIToken);
    }

    function frame(h: IAppHarness): string[] {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n");
    }

    it("Toggle Terminal spawns the shell in the secondary side bar, leaves the bottom panel alone, focuses the terminal", () => {
        const { h } = launch();
        moveTerminalRight(h);
        h.commands.execute(TOGGLE_TERMINAL);

        expect(sessions).toHaveLength(1);
        expect(h.workbench.workbenchLayout.getRightPanelVisible()).toBe(true);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(false);
        expect(keys(h).get("terminalFocus")).toBe(true);
        expect(keys(h).get("auxiliaryBarFocus")).toBe(true);
        const x = part(h).globalPosition.x;
        expect(frame(h).some((row) => row.slice(x).includes("$ ready"))).toBe(true);
        h.dispose();
    });

    it("input goes to the shell, emulator width equals the part width", () => {
        const { h } = launch();
        moveTerminalRight(h);
        h.commands.execute(TOGGLE_TERMINAL);
        frame(h);
        h.testApp.sendKey("l");
        h.testApp.sendKey("s");
        expect(sessions[0].writes.join("")).toContain("ls");
        // The part is 30 columns (a quarter of 120): the sash column and the tab strip padding don't count.
        const cols = sessions[0].resizes.at(-1)?.cols ?? 0;
        expect(cols).toBeGreaterThan(20);
        expect(cols).toBeLessThan(part(h).layoutSize.width);

        h.commands.execute("workbench.action.increaseViewSize");
        frame(h);
        expect(sessions[0].resizes.at(-1)?.cols).toBe(cols + 3);
        h.dispose();
    });

    it("a second Toggle Terminal hides the secondary side bar", () => {
        const { h } = launch();
        moveTerminalRight(h);
        h.commands.execute(TOGGLE_TERMINAL);
        h.commands.execute(TOGGLE_TERMINAL);
        expect(h.workbench.workbenchLayout.getRightPanelVisible()).toBe(false);
        expect(sessions).toHaveLength(1);
        expect(keys(h).get("terminalFocus")).toBe(false);
        h.dispose();
    });

    it("clicking the TERMINAL tab in the secondary side bar triggers the lazy spawn", () => {
        const { h } = launch();
        moveTerminalRight(h);
        h.container.get(AuxiliaryBarServiceDIToken).setVisible(true);
        expect(sessions).toHaveLength(0);
        const container = h.container.get(ViewsServiceDIToken).getViewContainerByViewId(TERMINAL_VIEW_ID)!;
        part(h).onActivateView?.(container);
        expect(sessions).toHaveLength(1);
        h.dispose();
    });

    it("closing the last terminal with hideOnLastClosed hides the secondary side bar, not the bottom panel", () => {
        const { h } = launch({ "terminal.integrated.hideOnLastClosed": true });
        h.container.get(PanelServiceDIToken).setVisible(true);
        moveTerminalRight(h);
        h.commands.execute(TOGGLE_TERMINAL);
        const terminal = h.container.get(TerminalServiceDIToken);
        terminal.closeInstance(terminal.getActiveInstance()!.id);
        expect(h.workbench.workbenchLayout.getRightPanelVisible()).toBe(false);
        expect(h.workbench.workbenchLayout.getBottomPanelVisible()).toBe(true);
        h.dispose();
    });

    it("survives a restart: tab in the secondary side bar, bar visible, shell spawns on activation", () => {
        const first = launch();
        moveTerminalRight(first.h);
        first.h.commands.execute(TOGGLE_TERMINAL);
        first.state.flushSync();
        first.h.dispose();

        const second = launch();
        const auxiliaryBar = second.h.container.get(AuxiliaryBarServiceDIToken);
        expect(auxiliaryBar.getViews().map((v) => v.title)).toEqual(["TERMINAL"]);
        expect(second.h.workbench.workbenchLayout.getRightPanelVisible()).toBe(true);
        expect(
            second.h.container
                .get(PanelServiceDIToken)
                .getViews()
                .map((v) => v.title),
        ).not.toContain("TERMINAL");
        // As in the bottom panel, restore doesn't spawn a shell until the first activation.
        expect(sessions).toHaveLength(1);
        second.h.commands.execute(TOGGLE_TERMINAL);
        expect(sessions).toHaveLength(2);
        expect(second.h.workbench.workbenchLayout.getRightPanelVisible()).toBe(true);
        second.h.dispose();
    });
});
