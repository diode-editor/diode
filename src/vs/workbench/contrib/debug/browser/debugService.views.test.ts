// What the debug service does for the Run and Debug views: the watch expressions stored per workspace, the new
// empty one selected for its input, and showing the viewlet by `debug.openDebug`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { type IConfig, State } from "../common/debug.ts";
import type { ViewModel } from "../common/debugViewModel.ts";

const WATCH_KEY = "debug.watchexpressions";

describe("DebugService for the views", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        fx.service.dispose();
    });

    function stored(): unknown {
        const key = [...fx.state.values.keys()].find((k) => k.endsWith(WATCH_KEY));
        return key === undefined ? undefined : fx.state.values.get(key);
    }

    function names(): string[] {
        return fx.service
            .getModel()
            .getWatchExpressions()
            .map((we) => we.name);
    }

    async function start(config: Partial<IConfig> = {}): Promise<void> {
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, ...config })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
    }

    describe("watch expressions", () => {
        it("add, rename, move and remove go to the workspace store", () => {
            fx.service.addWatchExpression("a");
            fx.service.addWatchExpression("b");
            const [a, b] = fx.service.getModel().getWatchExpressions();
            expect(stored()).toEqual([
                { name: "a", id: a.getId() },
                { name: "b", id: b.getId() },
            ]);

            fx.service.renameWatchExpression(a.getId(), "a2");
            expect(stored()).toEqual([
                { name: "a2", id: a.getId() },
                { name: "b", id: b.getId() },
            ]);

            fx.service.moveWatchExpression(b.getId(), 0);
            expect(names()).toEqual(["b", "a2"]);
            expect(stored()).toEqual([
                { name: "b", id: b.getId() },
                { name: "a2", id: a.getId() },
            ]);

            fx.service.removeWatchExpressions(b.getId());
            expect(stored()).toEqual([{ name: "a2", id: a.getId() }]);
            fx.service.removeWatchExpressions();
            expect(names()).toEqual([]);
            expect(stored()).toBeUndefined();
        });

        it("a new one without a name is selected for its input; a named one is not", () => {
            const viewModel = fx.service.getViewModel() as ViewModel;

            fx.service.addWatchExpression("named");
            expect(viewModel.getSelectedExpression()).toBeUndefined();

            fx.service.addWatchExpression();
            const empty = fx.service.getModel().getWatchExpressions()[1];
            expect(empty.name).toBe("");
            expect(viewModel.getSelectedExpression()).toEqual({ expression: empty, settingWatch: false });
            expect(fx.contextKeys.getRaw("expressionSelected")).toBe(true);
        });

        it("the expressions of the workspace come back with a new service", () => {
            fx.service.addWatchExpression("total / count");

            const again = createDebugServiceFixture({ state: fx.state });

            expect(
                again.service
                    .getModel()
                    .getWatchExpressions()
                    .map((we) => we.name),
            ).toEqual(["total / count"]);
            again.service.dispose();
        });
    });

    describe("debug.openDebug", () => {
        it("openOnDebugBreak (the default): not on the start, but on the stop at the breakpoint", async () => {
            const opened: number[] = [];
            fx.service.onWillNewSession(() => opened.push(fx.viewletOpenings));

            await start();

            expect(opened).toEqual([0]);
            await vi.waitFor(() => {
                expect(fx.viewletOpenings).toBe(1);
            });
        });

        it("openOnSessionStart: on every start, before the stop", async () => {
            await fx.configuration.updateValue("debug.openDebug", "openOnSessionStart");
            const opened: number[] = [];
            fx.service.onDidNewSession(() => opened.push(fx.viewletOpenings));

            await start();
            await fx.service.stopSession(undefined);
            await start();

            // The stops on the breakpoint do not open it again.
            expect(opened).toEqual([1, 2]);
            expect(fx.viewletOpenings).toBe(2);
        });

        it("openOnFirstSessionStart: only the first session of the window", async () => {
            await fx.configuration.updateValue("debug.openDebug", "openOnFirstSessionStart");

            await start();
            await fx.service.stopSession(undefined);
            await start();

            expect(fx.viewletOpenings).toBe(1);
        });

        it("neverOpen, a run without debugging and a session that suppresses the view do not open it", async () => {
            await fx.configuration.updateValue("debug.openDebug", "openOnSessionStart");
            await start({ noDebug: true });
            await fx.service.stopSession(undefined);
            expect(
                await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG }, { suppressDebugView: true }),
            ).toBe(true);
            await vi.waitFor(() => {
                expect(fx.service.state).toBe(State.Stopped);
            });
            await fx.service.stopSession(undefined);
            await fx.configuration.updateValue("debug.openDebug", "neverOpen");
            await start();

            expect(fx.viewletOpenings).toBe(0);
        });
    });
});
