// Цвета встроенного терминала: 16 ANSI-цветов, в которые эмулятор разворачивает
// palette-ячейки, и дефолтные фон/текст поверх токенов темы. Источник —
// `terminal.integrated.colorSource`: тема (`terminal.ansi*`, как в vscode) либо
// хост-терминал, в котором запущен diode (его ответы на OSC 4/10/11). Чего хост не
// сообщил, берётся из темы поштучно. Смена темы или настройки — новое событие.
//
// Хост спрашивается не раньше фазы `restored`: к ней `app.run()` уже перевёл tty в
// raw-режим. Запрос из конструктора (сервис строится до `run()`) уходил, пока tty
// ещё в cooked-режиме с ECHO, — ядро печатало ответы терминала (`^[]10;rgb:…`) на
// основной экран, и после выхода из alt-screen они оставались мусором в шелле.

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
    /** Цвета palette-индексов 0..15 (всегда 16). */
    readonly ansi: readonly number[];
    /**
     * Дефолтные фон и текст терминала поверх токенов `terminal.background` /
     * `terminal.foreground` (var-scope виджета); `undefined` — токен темы как есть.
     */
    readonly background: number | undefined;
    readonly foreground: number | undefined;
}

/**
 * Цвета терминала: что сообщил хост-терминал (`host`), то от него, остальное — из
 * темы поштучно. `undefined` (режим темы или хост ещё не ответил) — всё из темы.
 */
export function resolveTerminalColors(theme: WorkbenchTheme, host: HostTerminalColors | undefined): ITerminalColors {
    return {
        ansi: TERMINAL_ANSI_COLOR_KEYS.map((key, index) => host?.ansi[index] ?? theme.getRequiredColor(key)),
        background: host?.background,
        foreground: host?.foreground,
    };
}

/**
 * Держит актуальные {@link ITerminalColors} и сообщает об их смене. Хост-терминал
 * спрашивается один раз, только в режиме `host` и не раньше фазы `restored` — в
 * режиме темы diode в терминал запросов не шлёт.
 */
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
