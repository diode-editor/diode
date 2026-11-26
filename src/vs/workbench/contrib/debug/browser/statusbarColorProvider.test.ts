import { describe, expect, it } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { type IDebugSession, State } from "../common/debug.ts";

import { isStatusbarInDebugMode, StatusBarColorProvider } from "./statusbarColorProvider.ts";

function session(options: { noDebug?: boolean; suppressDebugStatusbar?: boolean } = {}): IDebugSession {
    return {
        configuration: { type: "t", request: "launch", name: "n", noDebug: options.noDebug },
        suppressDebugStatusbar: options.suppressDebugStatusbar ?? false,
    } as unknown as IDebugSession;
}

describe("isStatusbarInDebugMode", () => {
    it("inactive and initializing are not; stopped and running are", () => {
        const sessions = [session()];
        expect(isStatusbarInDebugMode(State.Inactive, sessions)).toBe(false);
        expect(isStatusbarInDebugMode(State.Initializing, sessions)).toBe(false);
        expect(isStatusbarInDebugMode(State.Stopped, sessions)).toBe(true);
        expect(isStatusbarInDebugMode(State.Running, sessions)).toBe(true);
    });

    it("not while every session runs without debugging or suppresses the status bar", () => {
        expect(isStatusbarInDebugMode(State.Running, [session({ noDebug: true })])).toBe(false);
        expect(isStatusbarInDebugMode(State.Running, [session({ suppressDebugStatusbar: true })])).toBe(false);
        expect(isStatusbarInDebugMode(State.Running, [session({ noDebug: true }), session({ noDebug: false })])).toBe(
            true,
        );
    });
});

describe("StatusBarColorProvider", () => {
    function setup(settings: Record<string, unknown> = {}) {
        const stateEmitter = new Emitter<State>();
        const debug: { state: State; sessions: IDebugSession[] } = { state: State.Inactive, sessions: [session()] };
        const statusBar = new StatusBarService(NULL_STATE_SERVICE);
        const configuration = createTestConfigurationService(settings);
        const provider = new StatusBarColorProvider(
            {
                get state() {
                    return debug.state;
                },
                onDidChangeState: stateEmitter.event,
                getModel: () => ({ getSessions: () => debug.sessions }) as never,
            },
            statusBar,
            configuration,
        );
        const setState = (state: State): void => {
            debug.state = state;
            stateEmitter.fire(state);
        };
        return { provider, statusBar, configuration, setState };
    }

    it("the debugging colors while debugging, the bar's own after", () => {
        const { statusBar, setState } = setup();
        expect(statusBar.styleOverride()).toBeUndefined();

        setState(State.Stopped);
        expect(statusBar.styleOverride()).toEqual({
            priority: 10,
            foreground: "statusBar.debuggingForeground",
            background: "statusBar.debuggingBackground",
        });
        // Stopped to running: the same override stays.
        const first = statusBar.styleOverride();
        setState(State.Running);
        expect(statusBar.styleOverride()).toBe(first);

        setState(State.Inactive);
        expect(statusBar.styleOverride()).toBeUndefined();
    });

    it("debug.enableStatusBarColor: false keeps the bar's colors, and switching it applies at once", async () => {
        const { statusBar, configuration, setState } = setup({ "debug.enableStatusBarColor": false });
        setState(State.Stopped);
        expect(statusBar.styleOverride()).toBeUndefined();

        await configuration.updateValue("debug.enableStatusBarColor", true);
        expect(statusBar.styleOverride()?.background).toBe("statusBar.debuggingBackground");
        await configuration.updateValue("debug.enableStatusBarColor", false);
        expect(statusBar.styleOverride()).toBeUndefined();
    });

    it("dispose takes the override away; disposed while inactive is fine", () => {
        const debugging = setup();
        debugging.setState(State.Stopped);
        debugging.provider.dispose();
        expect(debugging.statusBar.styleOverride()).toBeUndefined();

        const idle = setup();
        expect(() => {
            idle.provider.dispose();
        }).not.toThrow();
    });
});
