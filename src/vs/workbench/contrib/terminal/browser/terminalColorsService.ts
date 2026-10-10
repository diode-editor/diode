// Цвета встроенного терминала: 16 ANSI-цветов, в которые эмулятор разворачивает
// palette-ячейки, и дефолтные фон/текст поверх токенов темы. Источник —
// `terminal.integrated.colorSource`: тема (`terminal.ansi*`, как в vscode) либо
// хост-терминал, в котором запущен diode (его ответы на OSC 4/10/11). Чего хост не
// сообщил, берётся из темы поштучно. Смена темы или настройки — новое событие.

import type { HostTerminalColors, ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { TerminalBackendDIToken } from "../../../../platform/terminal/common/terminalBackendDIToken.ts";
import { TERMINAL_ANSI_COLOR_KEYS } from "../../../../platform/theme/common/colors/terminalColors.ts";
import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
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
 * спрашивается один раз и только в режиме `host` — в режиме темы diode в терминал
 * запросов не шлёт.
 */
export class TerminalColorsService extends Disposable {
    public static dependencies = [ThemeServiceDIToken, IConfigurationServiceDIToken, TerminalBackendDIToken] as const;

    private readonly onDidChangeEmitter = this.register(new Emitter<ITerminalColors>());
    public readonly onDidChange = this.onDidChangeEmitter.event;

    private hostColors: HostTerminalColors | undefined;
    private hostProbeStarted = false;
    private current: ITerminalColors;

    public constructor(
        private readonly themeService: ThemeService,
        private readonly configuration: IConfigurationService,
        private readonly backend: ITerminalBackend,
    ) {
        super();
        this.current = this.compute();
        this.probeHostIfNeeded();
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
        if (!this.usesHost || this.hostProbeStarted) return;
        this.hostProbeStarted = true;
        this.backend.probeHostColors((colors) => {
            this.hostColors = colors;
            this.update();
        });
    }
}
