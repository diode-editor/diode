// What the debug service does for the Debug Console: showing it by `debug.internalConsoleOptions` (the setting or
// the launch configuration's own), after a failed launch that logged something, and closing it at the end of the
// last session by `debug.console.closeOnEnd`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { MockDebugAdapter } from "../../../../../TestUtils/mockDebugAdapter.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { type IConfig, State } from "../common/debug.ts";

describe("DebugService for the Debug Console", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    const mocks: MockDebugAdapter[] = [];

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        for (const adapter of mocks.splice(0)) adapter.dispose();
        fx.service.dispose();
    });

    async function start(config: Partial<IConfig> = {}): Promise<void> {
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, ...config })).toBe(true);
        await vi.waitFor(() => {
            expect(fx.service.state).toBe(State.Stopped);
        });
    }

    async function stop(): Promise<void> {
        await fx.service.stopSession(undefined);
        await vi.waitFor(() => {
            expect(fx.service.getModel().getSessions()).toHaveLength(0);
        });
    }

    describe("debug.internalConsoleOptions", () => {
        it("openOnFirstSessionStart (the default): once launched, only the first session of the window", async () => {
            const opened: number[] = [];
            fx.service.onWillNewSession(() => opened.push(fx.replOpenings));
            fx.service.onDidNewSession(() => opened.push(fx.replOpenings));

            await start();
            await stop();
            await start();

            // Not before the launch: after it, before the session is announced.
            expect(opened).toEqual([0, 1, 1, 1]);
        });

        it("openOnSessionStart: on every start", async () => {
            await fx.configuration.updateValue("debug.internalConsoleOptions", "openOnSessionStart");

            await start();
            await stop();
            await start();

            expect(fx.replOpenings).toBe(2);
        });

        it("neverOpen keeps it closed; the launch configuration's own option wins over the setting", async () => {
            await fx.configuration.updateValue("debug.internalConsoleOptions", "neverOpen");
            await start();
            await stop();
            expect(fx.replOpenings).toBe(0);

            await start({ internalConsoleOptions: "openOnSessionStart" });
            expect(fx.replOpenings).toBe(1);
            await stop();

            await fx.configuration.updateValue("debug.internalConsoleOptions", "openOnSessionStart");
            await start({ internalConsoleOptions: "neverOpen" });
            expect(fx.replOpenings).toBe(1);
        });
    });

    describe("a failed launch", () => {
        function registerMock(output: string | undefined): void {
            fx.service.getAdapterManager().registerDebugger({ type: "mock" });
            fx.service.getAdapterManager().registerDebugAdapterFactory(["mock"], {
                createDebugAdapter: () => {
                    const adapter = new MockDebugAdapter();
                    adapter.handlers.set("launch", () => {
                        if (output !== undefined) adapter.sendEventBody("output", { category: "stderr", output });
                        return new Error("no program");
                    });
                    mocks.push(adapter);
                    return adapter;
                },
                substituteVariables: (_folder, config) => Promise.resolve(config),
            });
        }

        it("shows the console when the adapter logged something there", async () => {
            await fx.configuration.updateValue("debug.internalConsoleOptions", "neverOpen");
            registerMock("cannot find ./hello\n");

            expect(await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" })).toBe(
                false,
            );

            expect(fx.replOpenings).toBe(1);
        });

        it("leaves it alone when nothing was logged", async () => {
            registerMock(undefined);

            expect(await fx.service.startDebugging(undefined, { type: "mock", name: "m", request: "launch" })).toBe(
                false,
            );

            expect(fx.replOpenings).toBe(0);
        });
    });

    describe("debug.console.closeOnEnd", () => {
        it("closes the console when the last session ends", async () => {
            await fx.configuration.updateValue("debug.console.closeOnEnd", true);
            await start();
            await start();
            const [first] = fx.service.getModel().getSessions();

            await fx.service.stopSession(first);
            await vi.waitFor(() => {
                expect(fx.service.getModel().getSessions()).toHaveLength(1);
            });
            expect(fx.replClosings).toBe(0);

            await stop();
            expect(fx.replClosings).toBe(1);
        });

        it("is off by default", async () => {
            await start();
            await stop();

            expect(fx.replClosings).toBe(0);
        });
    });
});
