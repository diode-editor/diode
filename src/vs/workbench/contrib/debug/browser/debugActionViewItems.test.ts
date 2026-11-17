// The launcher of the Run and Debug title on the debug service: its rows (groups of `presentation`, recent dynamic
// configurations, "No Configurations"), what selecting one does, and the ▶ button's keys and clicks.

import { Point } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import { SYNTHETIC_LAUNCH_CONFIG } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Emitter, Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { WorkbenchState } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { type IDynamicConfigurationProvider, State } from "../common/debug.ts";

import { NO_CONFIGURATIONS, StartDebugActionViewItem } from "./debugActionViewItems.ts";
import { ConfigurationManager } from "./debugConfigurationManager.ts";

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

    /** As the user picks a row: the select box shows it, then tells the launcher. */
    function select(index: number): void {
        item.dropdown.select(index);
        item.dropdown.onDidSelect?.({ selected: "", index });
    }

    function selectedIndex(): unknown {
        return item.dropdown.inspectState().selectedIndex;
    }

    function dynamicType(label: string, picked: IDynamicConfigurationProvider["pick"]): IDynamicConfigurationProvider {
        return { label, type: label.toLowerCase(), pick: picked, getProvider: () => Promise.resolve(undefined) };
    }

    it("types with dynamic configurations that can't be listed are reported; the configurations stay", async () => {
        const error = new Error("no extensions");
        const dynamic = vi.spyOn(ConfigurationManager.prototype, "getDynamicProviders").mockRejectedValueOnce(error);
        const unexpected: unknown[] = [];
        setUnexpectedErrorHandler((e) => unexpected.push(e));
        try {
            create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });

            await vi.waitFor(() => {
                expect(unexpected).toEqual([error]);
            });
        } finally {
            setUnexpectedErrorHandler(() => undefined);
            dynamic.mockRestore();
        }
        expect(rows()).toEqual(["Run", "─", "Add Configuration..."]);
    });

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

    it("a row that selects nothing puts the select box back on the selected configuration", async () => {
        create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
        expect(rows()).toEqual(["Run", "─", "Add Configuration..."]);

        select(2);
        await flushMicrotasks();

        expect(executed).toEqual([
            ["debug.addConfiguration", fx.service.getConfigurationManager().getLaunches()[0].uri.toString()],
        ]);
        expect(item.dropdown.inspectState().selectedText).toBe("Run");
    });

    it("a configuration outside a group and the groups after it each start a category", () => {
        create({
            configurations: [
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Plain" },
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "A", presentation: { group: "1" } },
            ],
        });

        expect(rows()).toEqual(["A", "─", "Plain", "─", "Add Configuration..."]);
    });

    it("of two configurations with the same name the one of the selected launch is selected; the user's launch adds no row", async () => {
        create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
        const manager = fx.service.getConfigurationManager();
        await fx.configuration.updateValue("launch", { configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
        const user = manager.getLaunches().find((launch) => launch.hidden)!;
        await manager.selectConfiguration(user, "Run");

        expect(rows()).toEqual(["Run", "Run", "─", "Add Configuration..."]);
        expect(selectedIndex()).toBe(1);
        await manager.selectConfiguration(manager.getLaunches()[0], "Run");
        expect(selectedIndex()).toBe(0);
    });

    it("the three latest dynamic configurations, the selected one by its name and type", async () => {
        create({});
        const manager = fx.service.getConfigurationManager();
        for (const [name, type] of [
            ["Old", "a"],
            ["X", "b"],
            ["X", "a"],
            ["Y", "a"],
        ]) {
            await manager.selectConfiguration(undefined, name, undefined, { type });
        }
        expect(rows()).toEqual(["Y", "X", "X", "─", "Add Configuration..."]);
        expect(selectedIndex()).toBe(0);

        await manager.selectConfiguration(undefined, "X", undefined, { type: "b" });

        expect(rows()).toEqual(["X", "Y", "X", "─", "Add Configuration..."]);
        expect(selectedIndex()).toBe(0);
    });

    it("a type with dynamic configurations: the picked one is selected, a cancelled picker selects nothing", async () => {
        const picks: Awaited<ReturnType<IDynamicConfigurationProvider["pick"]>>[] = [];
        const dynamic = vi
            .spyOn(ConfigurationManager.prototype, "getDynamicProviders")
            .mockResolvedValue([dynamicType("Demo", () => Promise.resolve(picks.shift()))]);
        try {
            create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
            await vi.waitFor(() => {
                expect(rows()).toEqual(["Run", "─", "Demo...", "Add Configuration..."]);
            });
            const manager = fx.service.getConfigurationManager();

            select(2);
            await flushMicrotasks();
            expect(item.dropdown.inspectState().selectedText).toBe("Run");

            picks.push({
                launch: manager.getLaunches()[0],
                config: { ...SYNTHETIC_LAUNCH_CONFIG, name: "Dyn" },
                label: "Dyn",
            });
            select(2);
            await vi.waitFor(() => {
                expect(item.dropdown.inspectState().selectedText).toBe("Dyn");
            });
            expect([manager.selectedConfiguration.name, manager.selectedConfiguration.type]).toEqual(["Dyn", "demo"]);
        } finally {
            dynamic.mockRestore();
        }
    });

    it("follows launch changes and the product icons", async () => {
        const icons = new Emitter<void>();
        let glyph = "▶";
        fx = createDebugServiceFixture({ workspaceLaunch: { configurations: [] }, folders: [FOLDER] });
        executed = [];
        item = new StartDebugActionViewItem(
            fx.service,
            fx.configuration,
            { execute: (...args: unknown[]) => executed.push(args) },
            { getWorkbenchState: () => "folder" },
            { codicon: () => glyph, onDidChange: icons.event },
        );
        expect(item.start.getText()).toBe(" ▶ ");

        glyph = "»";
        icons.fire();
        await fx.configuration.updateValue("debug.toolBarLocation", "docked");
        expect(rows()).toEqual([NO_CONFIGURATIONS, "─", "Add Configuration..."]);
        await fx.configuration.updateValue(
            "launch",
            { configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "New" }] },
            "workspace",
        );

        expect(item.start.getText()).toBe(" » ");
        expect(rows()).toEqual(["New", "─", "Add Configuration..."]);
    });

    it("launch.json edited on disk: a renamed configuration that is not selected is renamed in the rows", async () => {
        create({
            configurations: [
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" },
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "Other" },
            ],
        });

        await fx.configuration.updateValue(
            "launch",
            {
                configurations: [
                    { ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" },
                    { ...SYNTHETIC_LAUNCH_CONFIG, name: "Renamed" },
                ],
            },
            "workspace",
        );

        expect(rows()).toEqual(["Run", "Renamed", "─", "Add Configuration..."]);
    });

    it("the label shrinks down to eight characters in a narrow title", async () => {
        create({});
        await fx.service.getConfigurationManager().selectConfiguration(undefined, "A long dynamic one", undefined, {
            type: "dyn",
        });

        expect(item.dropdown.getMinIntrinsicWidth(1)).toBe(8 + 2);
        expect(item.dropdown.getMaxIntrinsicWidth(1)).toBe("A long dynamic one".length + 2);
    });

    it("▶ in the start color, highlighted when hovered or focused; a key other than a press does nothing", () => {
        create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
        const theme = WorkbenchTheme.fromThemeFile(darkPlusTheme);
        const at = (): { fg: unknown; bg: unknown } => {
            const r = renderElement(item.start, 3, 1, { themeVars: true });
            return { fg: r.getFgAt(new Point(1, 0)), bg: r.getBgAt(new Point(1, 0)) };
        };
        const rest = at();
        expect(rest.fg).toBe(theme.getColor("debugIcon.startForeground"));
        expect(item.start.focusable).toBe(true);

        for (const state of ["hover", "focus"] as const) {
            item.start.setStyleState(state, true);
            expect(at().bg, state).not.toBe(rest.bg);
            item.start.setStyleState(state, false);
        }

        const up = new TUIKeyboardEvent("keyup", { key: "Enter" });
        item.start.dispatchEvent(up);
        const down = new TUIKeyboardEvent("keydown", { key: "Enter" });
        item.start.dispatchEvent(down);
        expect(executed).toEqual([["workbench.action.debug.start"]]);
        expect(down.defaultPrevented).toBe(true);
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
