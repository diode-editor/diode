// The whole workbench with the synthetic debugger for the tests of the Run and Debug views: the screen as text,
// where a text is on it, the theme colors, and a session stopped at its first breakpoint.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { expect, vi } from "vitest";

import type { IDisposable } from "../vs/base/common/lifecycle.ts";
import { ContextKeyServiceDIToken } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { computeThemeVars } from "../vs/platform/theme/browser/themeStyleVars.ts";
import { DebugServiceDIToken } from "../vs/workbench/contrib/debug/browser/debugService.ts";
import { ThemeServiceDIToken } from "../vs/workbench/services/themes/common/themeTokens.ts";

import { createAppTestHarness, type IAppHarness } from "./AppTestHarness.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "./syntheticDebugAdapter.ts";

export interface IDebugViewletHarness {
    readonly h: IAppHarness;
    lines(): string[];
    screen(): string;
    /** Where `text` starts on screen; fails the test if it is not there. */
    find(text: string): Point;
    vars(): Record<string, number>;
    /** Starts the synthetic program and waits for its stop at the breakpoint. */
    startStopped(): Promise<SyntheticDebugAdapterFactory>;
    dispose(): Promise<void>;
}

export async function createDebugViewletHarness(size = new Size(120, 50)): Promise<IDebugViewletHarness> {
    const h = createAppTestHarness({ size });
    await h.workbench.activate();
    let registration: (IDisposable & { factory: SyntheticDebugAdapterFactory }) | undefined;

    const lines = (): string[] => {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n");
    };
    return {
        h,
        lines,
        screen: () => lines().join("\n"),
        find: (text) => {
            const rows = lines();
            const y = rows.findIndex((row) => row.includes(text));
            expect(y, `"${text}" on screen`).toBeGreaterThanOrEqual(0);
            return new Point(rows[y].indexOf(text), y);
        },
        vars: () => computeThemeVars(h.container.get(ThemeServiceDIToken).theme),
        startStopped: async () => {
            registration = registerSyntheticDebugger(
                h.container.get(DebugServiceDIToken).getAdapterManager(),
                NO_DELAY_TIMING,
            );
            await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
            await vi.waitFor(() => {
                expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
            });
            return registration.factory;
        },
        dispose: async () => {
            await h.container.get(DebugServiceDIToken).stopSession(undefined);
            registration?.factory.adapters.forEach((a) => {
                a.dispose();
            });
            registration?.dispose();
            h.dispose();
        },
    };
}
