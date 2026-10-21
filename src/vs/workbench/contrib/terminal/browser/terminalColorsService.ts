// The host is queried no earlier than the `restored` phase: by then `app.run()` has put the tty in
// raw mode. A query from the constructor went out in cooked mode with ECHO — the replies
// (`^[]10;rgb:…`) were left as garbage in the shell after leaving the alt screen.

import type { HostTerminalColors, ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { TerminalBackendDIToken } from "../../../../platform/terminal/common/terminalBackendDIToken.ts";
import { TERMINAL_ANSI_COLOR_KEYS } from "../../../../platform/theme/common/colors/terminalColors.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { LifecycleService } from "../../../services/lifecycle/browser/lifecycleService.ts";
import { LifecycleServiceDIToken } from "../../../services/lifecycle/browser/lifecycleService.ts";
import { LIFECYCLE_PHASES } from "../../../services/lifecycle/common/lifecyclePhase.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../../services/themes/common/themeTokens.ts";

export const TerminalColorsServiceDIToken = token<TerminalColorsService>("TerminalColorsService");

const COLOR_SOURCE_SETTING = "terminal.integrated.colorSource";

export interface ITerminalColors {
    /** Always 16: palette indices 0..15. */
    readonly ansi: readonly number[];
    /** Overrides the `terminal.background`/`terminal.foreground` tokens; `undefined` — the theme token as is. */
    readonly background: number | undefined;
    readonly foreground: number | undefined;
}

/** Whatever the host didn't report comes from the theme, per color; `host: undefined` — all from the theme. */
export function resolveTerminalColors(theme: WorkbenchTheme, host: HostTerminalColors | undefined): ITerminalColors {
    return {
        ansi: TERMINAL_ANSI_COLOR_KEYS.map((key, index) => host?.ansi[index] ?? theme.getRequiredColor(key)),
        background: host?.background,
        foreground: host?.foreground,
    };
}

/** In theme mode diode sends no queries to the terminal; the host is queried once. */
export class TerminalColorsService extends Disposable {
    public static dependencies = [
        ThemeServiceDIToken,
        IConfigurationServiceDIToken,
        TerminalBackendDIToken,
        LifecycleServiceDIToken,
    ] as const;

    private readonly onDidChangeEmitter = this.register(new Emitter<ITerminalColors>());
    public readonly onDidChange = this.onDidChangeEmitter.event;

    private hostColors: HostTerminalColors | undefined;
    private hostProbeStarted = false;
    /** The tty is already in raw mode (`restored` phase) — terminal replies won't echo to the screen. */
    private terminalReady = false;
    private current: ITerminalColors;

    public constructor(
        private readonly themeService: ThemeService,
        private readonly configuration: IConfigurationService,
        private readonly backend: ITerminalBackend,
        lifecycle: LifecycleService,
    ) {
        super();
        this.current = this.compute();
        const onTerminalReady = (): void => {
            this.terminalReady = true;
            this.probeHostIfNeeded();
        };
        if (LIFECYCLE_PHASES.indexOf(lifecycle.phase) >= LIFECYCLE_PHASES.indexOf("restored")) onTerminalReady();
        else
            this.register(
                lifecycle.onDidChangePhase((phase) => {
                    if (phase === "restored") onTerminalReady();
                }),
            );
        this.register(
            themeService.onThemeChange(() => {
                this.update();
            }),
        );
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration(COLOR_SOURCE_SETTING)) return;
                this.probeHostIfNeeded();
                this.update();
            }),
        );
    }

    public get colors(): ITerminalColors {
        return this.current;
    }

    private get usesHost(): boolean {
        return this.configuration.get(COLOR_SOURCE_SETTING) === "host";
    }

    private compute(): ITerminalColors {
        return resolveTerminalColors(this.themeService.theme, this.usesHost ? this.hostColors : undefined);
    }

    private update(): void {
        this.current = this.compute();
        this.onDidChangeEmitter.fire(this.current);
    }

    private probeHostIfNeeded(): void {
        if (!this.terminalReady || !this.usesHost || this.hostProbeStarted) return;
        this.hostProbeStarted = true;
        this.backend.probeHostColors((colors) => {
            this.hostColors = colors;
            this.update();
        });
    }
}
