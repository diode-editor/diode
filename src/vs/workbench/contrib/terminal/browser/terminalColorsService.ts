// Хост спрашивается не раньше фазы `restored`: к ней `app.run()` уже перевёл tty в
// raw-режим. Запрос из конструктора уходил в cooked-режиме с ECHO — ответы
// (`^[]10;rgb:…`) оставались мусором в шелле после выхода из alt-screen.

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
    /** Всегда 16: palette-индексы 0..15. */
    readonly ansi: readonly number[];
    /** Поверх токенов `terminal.background`/`terminal.foreground`; `undefined` — токен темы как есть. */
    readonly background: number | undefined;
    readonly foreground: number | undefined;
}

/** Чего хост не сообщил — из темы поштучно; `host: undefined` — всё из темы. */
export function resolveTerminalColors(theme: WorkbenchTheme, host: HostTerminalColors | undefined): ITerminalColors {
    return {
        ansi: TERMINAL_ANSI_COLOR_KEYS.map((key, index) => host?.ansi[index] ?? theme.getRequiredColor(key)),
        background: host?.background,
        foreground: host?.foreground,
    };
}

/** В режиме темы diode в терминал запросов не шлёт; хост спрашивается один раз. */
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
    /** tty уже в raw-режиме (фаза `restored`) — ответы терминала не уйдут эхом на экран. */
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
