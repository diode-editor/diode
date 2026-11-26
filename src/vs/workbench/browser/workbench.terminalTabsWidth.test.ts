import { Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { FakeTerminalSurface } from "../../../TestUtils/FakeTerminalSurface.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { resolveUserDataPaths } from "../../platform/environment/node/userDataPaths.ts";
import { loadState, type StateService } from "../../platform/state/node/stateService.ts";
import { TERMINAL_VIEW_ID } from "../contrib/terminal/browser/terminalService.ts";
import { TERMINAL_TABS_LIST_ID, TERMINAL_TABS_WIDTH } from "../contrib/terminal/browser/terminalTabsList.ts";
import { TerminalSessionFactoryDIToken } from "../contrib/terminal/common/terminalSessionFactory.ts";

import { ViewsServiceDIToken } from "./parts/views/viewsService.ts";

const SIZE = new Size(200, 30);

/** The list width is upstream's `StorageScope.PROFILE` state: it outlives a restart. */
describe("Workbench — terminal tabs list width across a restart", () => {
    let ws: ITempWorkspace;
    let userData: ITempWorkspace;
    let writers: StateService[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-tabswidth-ws-" });
        userData = createTempWorkspace({ prefix: "diode-tabswidth-home-" });
        writers = [];
    });

    afterEach(() => {
        for (const writer of writers) writer.dispose();
        ws.dispose();
        userData.dispose();
    });

    function launch(): { h: IAppHarness; state: StateService } {
        const state = loadState(resolveUserDataPaths({ homedir: "/never", userDataDir: userData.dir }));
        writers.push(state);
        const h = createAppTestHarness({
            workspaceFolder: ws.dir,
            stateService: state,
            size: SIZE,
            containerOverrides: (container) => {
                container.bind(TerminalSessionFactoryDIToken, () => () => new FakeTerminalSurface());
            },
        });
        return { h, state };
    }

    /** Two terminals, so the list is shown. */
    async function openTwoTerminals(h: IAppHarness): Promise<TUIElement> {
        await h.commands.execute("workbench.action.terminal.new");
        await h.commands.execute("workbench.action.terminal.new");
        h.testApp.render();
        const list = h.testApp.querySelector(`#${TERMINAL_TABS_LIST_ID}`);
        if (list === null) throw new Error("no tabs list");
        return list;
    }

    function drag(h: IAppHarness, list: TUIElement, by: number): void {
        // The list is on the right: the divider is the column left of it.
        const from = list.globalPosition.x - 1;
        const y = list.globalPosition.y + 1;
        const send = (action: MouseToken["action"], x: number): void => {
            h.testApp.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                action,
                x: x + 1,
                y: y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
            h.testApp.render();
        };
        send("press", from);
        send("move", from + by);
        send("release", from + by);
    }

    it("in the panel", async () => {
        const first = launch();
        const list = await openTwoTerminals(first.h);
        drag(first.h, list, -7);
        expect(list.layoutSize.width).toBe(TERMINAL_TABS_WIDTH + 7);
        first.state.flushSync();
        first.h.dispose();

        const second = launch();
        expect((await openTwoTerminals(second.h)).layoutSize.width).toBe(TERMINAL_TABS_WIDTH + 7);
        second.h.dispose();
    });

    it("in the secondary side bar, apart from the panel's", async () => {
        const first = launch();
        first.h.container.get(ViewsServiceDIToken).moveViewToLocation(TERMINAL_VIEW_ID, "auxiliarybar");
        // The bar is narrow: the list is clamped to 13 columns there, so narrow it down to the minimum.
        drag(first.h, await openTwoTerminals(first.h), 3);
        first.state.flushSync();
        first.h.dispose();

        const second = launch();
        expect((await openTwoTerminals(second.h)).layoutSize.width).toBe(10);
        second.h.container.get(ViewsServiceDIToken).moveViewToLocation(TERMINAL_VIEW_ID, "panel");
        await second.h.commands.execute("workbench.action.terminal.focus");
        second.h.testApp.render();
        const list = second.h.testApp.querySelector(`#${TERMINAL_TABS_LIST_ID}`);
        expect(list?.layoutSize.width).toBe(TERMINAL_TABS_WIDTH);
        second.h.dispose();
    });
});
