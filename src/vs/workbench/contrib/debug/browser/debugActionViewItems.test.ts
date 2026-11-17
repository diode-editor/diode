// The launcher of the Run and Debug title on the debug service: its rows (groups of `presentation`, recent dynamic
// configurations, "No Configurations"), what selecting one does, and the ▶ button's keys and clicks.

import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { SYNTHETIC_LAUNCH_CONFIG } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { WorkbenchState } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { State } from "../common/debug.ts";

import { NO_CONFIGURATIONS, StartDebugActionViewItem } from "./debugActionViewItems.ts";

const FOLDER = { uri: Uri.file("/w"), name: "w", index: 0 };

describe("StartDebugActionViewItem", () => {
    let fx: IDebugServiceFixture;
    let item: StartDebugActionViewItem;
    let executed: unknown[][];

    function create(launch: unknown, state: WorkbenchState = "folder"): void {
        fx = createDebugServiceFixture({ workspaceLaunch: launch, folders: [FOLDER] });
        executed = [];
        item = new StartDebugActionViewItem(
            fx.service,
            fx.configuration,
            { execute: (...args: unknown[]) => executed.push(args) },
            { getWorkbenchState: () => state },
            { codicon: () => "▶", onDidChange: Event.None },
        );
    }

    afterEach(() => {
        item.dispose();
        fx.service.dispose();
    });

    function rows(): unknown {
        return item.dropdown.inspectState().options;
    }

    function select(index: number): void {
        item.dropdown.onDidSelect?.({ selected: "", index });
    }

    it("a group of `presentation` starts after a separator", () => {
        create({
            configurations: [
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "A", presentation: { group: "1", order: 1 } },
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "B", presentation: { group: "1", order: 2 } },
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "C", presentation: { group: "2", order: 1 } },
            ],
        });

        expect(rows()).toEqual(["A", "B", "─", "C", "─", "Add Configuration..."]);
    });

    it("in a .code-workspace window the rows name their launch", () => {
        create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] }, "workspace");

        expect(rows()).toEqual(["Run (w)", "─", "Add Config (w)..."]);
    });

    it(`without configurations shows "${NO_CONFIGURATIONS}", which selects nothing`, async () => {
        create({});
        expect(rows()).toEqual([NO_CONFIGURATIONS, "─", "Add Configuration..."]);

        select(0);
        await flushMicrotasks();

        expect(item.dropdown.inspectState().selectedText).toBe(NO_CONFIGURATIONS);
        expect(fx.service.getConfigurationManager().selectedConfiguration.name).toBeUndefined();
    });

    it("a recent dynamic configuration is a row of its own group that selects it again", async () => {
        create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
        const manager = fx.service.getConfigurationManager();
        await manager.selectConfiguration(undefined, "Dyn", undefined, { type: "dyn" });
        await manager.selectConfiguration(manager.getLaunches()[0], "Run");
        expect(rows()).toEqual(["Run", "─", "Dyn", "─", "Add Configuration..."]);
        expect(item.dropdown.inspectState().selectedText).toBe("Run");

        select(2);
        await flushMicrotasks();

        expect([manager.selectedConfiguration.name, manager.selectedConfiguration.type]).toEqual(["Dyn", "dyn"]);
        expect(item.dropdown.inspectState().selectedText).toBe("Dyn");
    });

    it("▶ starts on a left click, Enter or Space, not while a session initializes", () => {
        create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
        const click = (button: "left" | "right"): void => {
            item.start.dispatchEvent(
                new TUIMouseEvent("click", { button, screenX: 0, screenY: 0, localX: 0, localY: 0 }),
            );
        };
        const key = (k: string): void => {
            item.start.dispatchEvent(new TUIKeyboardEvent("keydown", { key: k }));
        };

        click("right");
        key("a");
        expect(executed).toEqual([]);
        click("left");
        key("Enter");
        key(" ");
        vi.spyOn(fx.service, "state", "get").mockReturnValue(State.Initializing);
        click("left");

        expect(executed).toEqual([
            ["workbench.action.debug.start"],
            ["workbench.action.debug.start"],
            ["workbench.action.debug.start"],
        ]);
    });
});
