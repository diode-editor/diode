import { NO_HOST_COLORS } from "@tuidom/core/backend/iTerminalBackend";
import { packRgb } from "@tuidom/core/common/colorUtils";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";
import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { DialogService } from "../../dialogs/browser/dialogService.ts";
import { LifecycleService } from "../../lifecycle/browser/lifecycleService.ts";
import type { LifecyclePhase } from "../../lifecycle/common/lifecyclePhase.ts";
import { type ColorScheme, LAST_HOST_COLOR_SCHEME } from "../common/themeConfiguration.ts";

import { HostColorSchemeService } from "./hostColorSchemeService.ts";

const DARK_BG = { ...NO_HOST_COLORS, background: packRgb(0x1e, 0x1e, 0x2e) };
const LIGHT_BG = { ...NO_HOST_COLORS, background: packRgb(0xef, 0xf1, 0xf5) };

/** Only what the service touches: a map behind get/store. */
function memoryState(initial: Record<string, unknown> = {}): IStateService {
    const values = new Map(Object.entries(initial));
    return {
        get: <T>(descriptor: IStateDescriptor<T>): T =>
            values.has(descriptor.key) ? (values.get(descriptor.key) as T) : descriptor.default,
        store: <T>(descriptor: IStateDescriptor<T>, value: T): void => {
            values.set(descriptor.key, value);
        },
    } as IStateService;
}

function build(
    options: {
        settings?: Record<string, unknown>;
        reported?: ColorScheme;
        hostColors?: typeof NO_HOST_COLORS;
        remembered?: ColorScheme;
        phase?: LifecyclePhase;
    } = {},
) {
    const backend = new MockTerminalBackend();
    backend.colorScheme = options.reported;
    backend.hostColors = options.hostColors ?? NO_HOST_COLORS;
    const subscribe = vi.spyOn(backend, "onColorSchemeChange");
    const probe = vi.spyOn(backend, "probeHostColors");
    const configuration = createTestConfigurationService({
        "window.autoDetectColorScheme": true,
        ...options.settings,
    });
    const state = memoryState(
        options.remembered === undefined ? {} : { [LAST_HOST_COLOR_SCHEME.key]: options.remembered },
    );
    const lifecycle = new LifecycleService(new DialogService());
    lifecycle.setPhase(options.phase ?? "restored");
    const service = new HostColorSchemeService(backend, configuration, state, lifecycle);
    const changes = vi.fn();
    service.onDidChangeColorScheme(changes);
    return { service, backend, configuration, state, lifecycle, subscribe, probe, changes };
}

describe("HostColorSchemeService", () => {
    it("takes the terminal's mode-2031 answer and every later flip, remembering the last one", () => {
        const { service, backend, state } = build({ reported: "light", hostColors: DARK_BG });
        expect(service.colorScheme).toBe("light");

        const changes = vi.fn();
        service.onDidChangeColorScheme(changes);
        backend.sendColorScheme("dark");
        expect(service.colorScheme).toBe("dark");
        expect(changes).toHaveBeenCalledExactlyOnceWith("dark");
        expect(state.get(LAST_HOST_COLOR_SCHEME)).toBe("dark");
    });

    it("a report beats the background guess, even one that arrives later", () => {
        const { service, backend } = build({ hostColors: LIGHT_BG });
        expect(service.colorScheme).toBe("light");
        backend.sendColorScheme("dark");
        expect(service.colorScheme).toBe("dark");
    });

    it("without reports the OSC 11 background decides: dark and light", () => {
        expect(build({ hostColors: DARK_BG }).service.colorScheme).toBe("dark");
        expect(build({ hostColors: LIGHT_BG }).service.colorScheme).toBe("light");
    });

    it("a silent terminal leaves the remembered scheme; none remembered — unknown", () => {
        expect(build({ remembered: "light" }).service.colorScheme).toBe("light");
        expect(build().service.colorScheme).toBeUndefined();
    });

    it("the same scheme again fires nothing", () => {
        const { backend, changes } = build({ remembered: "dark" });
        backend.sendColorScheme("dark");
        expect(changes).not.toHaveBeenCalled();
    });

    it("detection off: the terminal is not asked; turning it on asks once", async () => {
        const { service, configuration, subscribe, probe } = build({
            settings: { "window.autoDetectColorScheme": false },
            reported: "light",
            remembered: "dark",
        });
        expect(subscribe).not.toHaveBeenCalled();
        expect(probe).not.toHaveBeenCalled();
        expect(service.colorScheme).toBe("dark");

        await configuration.updateValue("window.autoDetectColorScheme", true);
        expect(service.colorScheme).toBe("light");
        await configuration.updateValue("window.autoDetectColorScheme", false);
        await configuration.updateValue("window.autoDetectColorScheme", true);
        expect(subscribe).toHaveBeenCalledOnce();
        expect(probe).toHaveBeenCalledOnce();
    });

    it("waits for the restored phase: a query before raw mode would echo onto the screen", () => {
        const { lifecycle, subscribe, probe, service } = build({ phase: "ready", reported: "light" });
        expect(subscribe).not.toHaveBeenCalled();
        expect(probe).not.toHaveBeenCalled();

        lifecycle.setPhase("restored");
        expect(subscribe).toHaveBeenCalledOnce();
        expect(probe).toHaveBeenCalledOnce();
        expect(service.colorScheme).toBe("light");
    });

    it("a phase other than restored does not start detection", () => {
        const { lifecycle, subscribe } = build({ phase: "starting" });
        lifecycle.setPhase("ready");
        expect(subscribe).not.toHaveBeenCalled();
    });
});
