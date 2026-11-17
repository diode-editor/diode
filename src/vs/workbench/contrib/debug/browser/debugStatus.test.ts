import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { ProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { type ILaunch, State } from "../common/debug.ts";

import { SELECT_AND_START_ID } from "./debugCommands.ts";
import { DebugStatusContribution } from "./debugStatus.ts";

function launch(name: string): ILaunch {
    return { name } as ILaunch;
}

function setup(settings: Record<string, unknown> = {}) {
    const stateEmitter = new Emitter<State>();
    const selectEmitter = new Emitter<void>();
    const selection: { name: string | undefined; launch: ILaunch | undefined } = { name: undefined, launch: undefined };
    let launches = [launch("app")];
    const statusBar = new StatusBarService(NULL_STATE_SERVICE);
    const configuration = createTestConfigurationService({ "diode.icons.nerdFont": "off", ...settings });
    const execute = vi.fn();
    const icons = new ProductIconService(configuration, undefined);
    const contribution = new DebugStatusContribution(
        statusBar,
        {
            onDidChangeState: stateEmitter.event,
            getConfigurationManager: () =>
                ({
                    selectedConfiguration: selection,
                    getLaunches: () => launches,
                    onDidSelectConfiguration: selectEmitter.event,
                }) as never,
        },
        configuration,
        { execute },
        icons,
    );
    return {
        contribution,
        configuration,
        execute,
        text: (): string | undefined => statusBar.entries().find((e) => e.id === "status.debug")?.text,
        entry: () => statusBar.entries().find((e) => e.id === "status.debug"),
        start: (): void => {
            stateEmitter.fire(State.Running);
        },
        stop: (): void => {
            stateEmitter.fire(State.Inactive);
        },
        select: (name: string | undefined, launchName: string | null = "app"): void => {
            selection.name = name;
            selection.launch = launchName === null ? undefined : launch(launchName);
            selectEmitter.fire();
        },
        setLaunches: (names: string[]): void => {
            launches = names.map(launch);
        },
    };
}

describe("DebugStatusContribution (status.debug)", () => {
    it("onFirstSessionStart (default): no entry until a session starts, then it stays", () => {
        const t = setup();
        expect(t.entry()).toBeUndefined();
        t.stop();
        expect(t.entry()).toBeUndefined();

        t.start();
        expect(t.entry()).toMatchObject({ name: "Debug", alignment: "left", priority: 30 });
        t.stop();
        expect(t.entry()).toBeDefined();
    });

    it("always: there from the start; never: no entry, and switching to never removes it", async () => {
        const always = setup({ "debug.showInStatusBar": "always" });
        expect(always.entry()).toBeDefined();
        await always.configuration.updateValue("debug.showInStatusBar", "never");
        expect(always.entry()).toBeUndefined();

        const never = setup({ "debug.showInStatusBar": "never" });
        never.start();
        expect(never.entry()).toBeUndefined();
        await never.configuration.updateValue("debug.showInStatusBar", "always");
        expect(never.entry()).toBeDefined();
    });

    it("the icon and the selected configuration, with its launch while there are several; follows the selection", () => {
        const t = setup({ "debug.showInStatusBar": "always" });
        expect(t.text()).toBe("▶ ");

        t.select("Launch hello");
        expect(t.text()).toBe("▶ Launch hello");

        t.setLaunches(["app", "lib"]);
        t.select("Launch hello", "lib");
        expect(t.text()).toBe("▶ Launch hello (lib)");

        // A name without its launch, an empty name, no name.
        t.select("Launch hello", null);
        expect(t.text()).toBe("▶ ");
        t.select("");
        expect(t.text()).toBe("▶ ");
        t.select(undefined);
        expect(t.text()).toBe("▶ ");
    });

    it("follows the glyph set", async () => {
        const t = setup({ "debug.showInStatusBar": "always" });
        await t.configuration.updateValue("diode.icons.nerdFont", "on");
        expect(t.text()).toBe(" ");
    });

    it("a click runs Select and Start Debugging; dispose removes the entry", () => {
        const t = setup({ "debug.showInStatusBar": "always" });
        t.entry()?.onClick?.();
        expect(t.execute).toHaveBeenCalledWith(SELECT_AND_START_ID);

        t.contribution.dispose();
        expect(t.entry()).toBeUndefined();
    });
});
