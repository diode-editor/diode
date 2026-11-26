// The whole workbench with the synthetic debugger for the tests of the Run and Debug views: the viewlet open in a
// wide sidebar with plain glyphs, the screen as text, where a text is on it, the theme colors, and a session stopped
// at its first breakpoint.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { expect, vi } from "vitest";

import type { IDisposable } from "../vs/base/common/lifecycle.ts";
import { IConfigurationServiceDIToken } from "../vs/platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../vs/platform/contextkey/common/contextKeyService.ts";
import { computeThemeVars } from "../vs/platform/theme/browser/themeStyleVars.ts";
import { DebugServiceDIToken } from "../vs/workbench/contrib/debug/browser/debugService.ts";
import { LayoutServiceDIToken } from "../vs/workbench/services/layout/browser/layoutService.ts";
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
    /** The synthetic debug type, as an extension contributing a debugger would register it. */
    registerDebugger(): SyntheticDebugAdapterFactory;
    /** Starts the synthetic program and waits for its stop at the breakpoint. */
    startStopped(): Promise<SyntheticDebugAdapterFactory>;
    dispose(): Promise<void>;
}

/**
 * `programRoot`: where the synthetic program's sources are (`src/main.cpp`...), which the stop opens. `height`: the
 * screen's rows, for a test that needs taller sidebar sections than the default 50 give.
 */
export async function createDebugViewletHarness(
    workspaceFolder?: string,
    programRoot?: string,
    options: { readonly height?: number } = {},
): Promise<IDebugViewletHarness> {
    const h = createAppTestHarness({ size: new Size(120, options.height ?? 50), workspaceFolder });
    await h.workbench.activate();
    // Plain glyphs: the icons are characters the screen text shows.
    await h.container.get(IConfigurationServiceDIToken).updateValue("diode.icons.nerdFont", "off");
    await h.commands.execute("workbench.view.debug");
    // Room for a row and what follows its name.
    h.container.get(LayoutServiceDIToken).nudgeSidebarWidth(30);
    let registration: (IDisposable & { factory: SyntheticDebugAdapterFactory }) | undefined;

    const registerDebugger = (): SyntheticDebugAdapterFactory => {
        registration ??= registerSyntheticDebugger(
            h.container.get(DebugServiceDIToken).getAdapterManager(),
            NO_DELAY_TIMING,
            programRoot,
        );
        return registration.factory;
    };
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
        registerDebugger,
        startStopped: async () => {
            const factory = registerDebugger();
            await h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG });
            await vi.waitFor(() => {
                expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
            });
            return factory;
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
