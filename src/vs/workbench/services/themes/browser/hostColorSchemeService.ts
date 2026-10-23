// Upstream `IHostColorSchemeService` asks the OS; a TUI can only ask the terminal it runs in, so the "system color
// mode" is the terminal's scheme. Over ssh that is still the user's terminal, which is the point.

import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { TerminalBackendDIToken } from "../../../../platform/terminal/common/terminalBackendDIToken.ts";
import type { LifecycleService } from "../../lifecycle/browser/lifecycleService.ts";
import { LifecycleServiceDIToken } from "../../lifecycle/browser/lifecycleService.ts";
import { LIFECYCLE_PHASES } from "../../lifecycle/common/lifecyclePhase.ts";
import {
    AUTO_DETECT_COLOR_SCHEME_SETTING,
    type ColorScheme,
    colorSchemeOfBackground,
    LAST_HOST_COLOR_SCHEME,
} from "../common/themeConfiguration.ts";

export const HostColorSchemeServiceDIToken = token<HostColorSchemeService>("HostColorSchemeService");

/**
 * Two sources: the terminal's own reports (mode 2031 — the answer at startup and every later flip) and, for
 * terminals without them, the brightness of the OSC 11 background, asked once. A report beats the guess.
 * Nothing is sent to the terminal while `window.autoDetectColorScheme` is off.
 */
export class HostColorSchemeService extends Disposable {
    public static dependencies = [
        TerminalBackendDIToken,
        IConfigurationServiceDIToken,
        StateServiceDIToken,
        LifecycleServiceDIToken,
    ] as const;

    private readonly onDidChangeColorSchemeEmitter = this.register(new Emitter<ColorScheme>());
    public readonly onDidChangeColorScheme = this.onDidChangeColorSchemeEmitter.event;

    private current: ColorScheme | undefined;
    /** The tty is in raw mode (`restored` phase) — replies won't echo onto the screen. */
    private terminalReady = false;
    private detectionStarted = false;
    private reported = false;

    public constructor(
        private readonly backend: ITerminalBackend,
        private readonly configuration: IConfigurationService,
        private readonly state: IStateService,
        lifecycle: LifecycleService,
    ) {
        super();
        this.current = state.get(LAST_HOST_COLOR_SCHEME) ?? undefined;
        const onTerminalReady = (): void => {
            this.terminalReady = true;
            this.startDetectionIfNeeded();
        };
        if (LIFECYCLE_PHASES.indexOf(lifecycle.phase) >= LIFECYCLE_PHASES.indexOf("restored")) onTerminalReady();
        else
            this.register(
                lifecycle.onDidChangePhase((phase) => {
                    if (phase === "restored") onTerminalReady();
                }),
            );
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                // Stryker disable next-line ConditionalExpression: equivalent — startDetectionIfNeeded rereads the setting itself; the filter only skips a no-op call
                if (event.affectsConfiguration(AUTO_DETECT_COLOR_SCHEME_SETTING)) this.startDetectionIfNeeded();
            }),
        );
    }

    /** Before the terminal answers — the scheme it reported last time (any terminal); `undefined` — never known. */
    public get colorScheme(): ColorScheme | undefined {
        return this.current;
    }

    private startDetectionIfNeeded(): void {
        if (!this.terminalReady || this.detectionStarted || !this.configuration.get(AUTO_DETECT_COLOR_SCHEME_SETTING))
            return;
        this.detectionStarted = true;
        this.backend.onColorSchemeChange((scheme) => {
            this.reported = true;
            this.setColorScheme(scheme);
        });
        this.backend.probeHostColors((colors) => {
            if (this.reported || colors.background === undefined) return;
            this.setColorScheme(colorSchemeOfBackground(colors.background));
        });
    }

    private setColorScheme(scheme: ColorScheme): void {
        if (scheme === this.current) return;
        this.current = scheme;
        this.state.store(LAST_HOST_COLOR_SCHEME, scheme);
        this.onDidChangeColorSchemeEmitter.fire(scheme);
    }
}
