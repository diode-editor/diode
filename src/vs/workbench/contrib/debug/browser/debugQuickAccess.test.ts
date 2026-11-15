// Select and Start Debugging: the rows of the launch configurations picker and what accepting them does.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { WorkbenchState } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";

import { ADD_CONFIGURATION_ID, NO_DEBUG_RESULTS, StartDebugQuickAccessProvider } from "./debugQuickAccess.ts";

const FOLDER = { uri: Uri.file("/w"), name: "w", index: 0 };

describe("StartDebugQuickAccessProvider", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory | undefined;
    let executed: unknown[][];

    function create(
        launch: unknown,
        state: WorkbenchState = "folder",
        debuggers = true,
    ): StartDebugQuickAccessProvider {
        fx = createDebugServiceFixture({ workspaceLaunch: launch, folders: [FOLDER] });
        factory = debuggers
            ? registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory
            : undefined;
        executed = [];
        return new StartDebugQuickAccessProvider(
            fx.service,
            { getWorkbenchState: () => state },
            { execute: (...args: unknown[]) => executed.push(args) },
        );
    }

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory?.adapters ?? []) adapter.dispose();
        fx.service.dispose();
    });

    const twoConfigs = {
        configurations: [
            { ...SYNTHETIC_LAUNCH_CONFIG, name: "Run hello" },
            { ...SYNTHETIC_LAUNCH_CONFIG, name: "Attach" },
        ],
    };

    it("lists the configurations, the selected one first as the most recent, then Add Configuration...", () => {
        const provider = create(twoConfigs);
        void fx.service.getConfigurationManager().selectConfiguration(undefined, "Attach");

        expect(provider.getItems("debug ").map((i) => [i.label, i.description, i.hint])).toEqual([
            ["Attach", "", "most recent"],
            ["Run hello", "", undefined],
            ["Add Configuration...", "", undefined],
        ]);
        expect(provider.getPlaceholder()).toBe("Type the name of a launch configuration to run.");
    });

    it("of two configurations with the selected name only the one of the selected launch is the most recent", async () => {
        const provider = create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
        await fx.configuration.updateValue(
            "launch",
            { configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] },
            "user",
        );
        const manager = fx.service.getConfigurationManager();
        await manager.selectConfiguration(manager.getLaunches()[0], "Run");

        expect(provider.getItems("debug ").map((i) => i.hint)).toEqual(["most recent", undefined, undefined]);
    });

    it("filters the configurations by the text after the prefix, with the matched characters", () => {
        const provider = create(twoConfigs);

        const items = provider.getItems("debug hel");

        expect(items.map((i) => i.label)).toEqual(["Run hello", "Add Configuration..."]);
        expect(items[0].labelMatchRanges).toEqual([[4, 7]]);
        expect(items[1].labelMatchRanges).toBeUndefined();
    });

    it("in a .code-workspace window the rows name their launch", () => {
        const provider = create(twoConfigs, "workspace");

        expect(provider.getItems("debug ").map((i) => [i.label, i.description])).toEqual([
            ["Run hello", "w"],
            ["Attach", "w"],
            ["Add Config (w)...", "w"],
        ]);
    });

    it("without debuggers there is only the no-results row", () => {
        const provider = create(twoConfigs, "folder", false);

        expect(provider.getItems("debug ")).toEqual([{ label: NO_DEBUG_RESULTS }]);
    });

    it("accepting a configuration selects and starts it; Add Configuration... adds one to its launch", async () => {
        const provider = create(twoConfigs);
        const start = vi.spyOn(fx.service, "startDebugging");
        const [, attach, add] = provider.getItems("debug ");

        attach.accept?.();
        add.accept?.();

        await vi.waitFor(() => {
            expect(start).toHaveBeenCalledWith(fx.service.getConfigurationManager().getLaunches()[0], undefined, {
                startedByUser: true,
            });
        });
        expect(fx.service.getConfigurationManager().selectedConfiguration.name).toBe("Attach");
        expect(executed).toEqual([[ADD_CONFIGURATION_ID, "file:///w/.diode/launch.json"]]);
    });

    it("a failed start is not thrown at the picker", async () => {
        const provider = create({ configurations: [{ name: "Broken", type: "synthetic", request: "nope" }] });
        const start = vi.spyOn(fx.service, "startDebugging").mockRejectedValueOnce(new Error("boom"));

        provider.getItems("debug ")[0].accept?.();

        await vi.waitFor(() => {
            expect(start).toHaveBeenCalled();
        });
    });
});
