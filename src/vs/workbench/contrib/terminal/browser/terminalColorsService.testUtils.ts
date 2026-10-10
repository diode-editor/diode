import { type HostTerminalColors, NO_HOST_COLORS } from "@tuidom/core/backend/iTerminalBackend";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";

import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";

import { TerminalColorsService } from "./terminalColorsService.ts";

/**
 * Сервис цветов терминала для юнитов компонента: хост-терминал — мок, отвечающий
 * `hostColors` (по умолчанию — ничего не сообщил).
 */
export function makeTerminalColors(
    themeService: ThemeService,
    configuration: IConfigurationService,
    hostColors: HostTerminalColors = NO_HOST_COLORS,
): { colors: TerminalColorsService; backend: MockTerminalBackend } {
    const backend = new MockTerminalBackend();
    backend.hostColors = hostColors;
    return { colors: new TerminalColorsService(themeService, configuration, backend), backend };
}
