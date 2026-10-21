import { type HostTerminalColors, NO_HOST_COLORS } from "@tuidom/core/backend/iTerminalBackend";
import { MockTerminalBackend } from "@tuidom/testing/mockTerminalBackend";

import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { DialogService } from "../../../services/dialogs/browser/dialogService.ts";
import { LifecycleService } from "../../../services/lifecycle/browser/lifecycleService.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";

import { TerminalColorsService } from "./terminalColorsService.ts";

/** Starts already in the `restored` phase — the host is queried immediately. */
export function makeTerminalColors(
    themeService: ThemeService,
    configuration: IConfigurationService,
    hostColors: HostTerminalColors = NO_HOST_COLORS,
): { colors: TerminalColorsService; backend: MockTerminalBackend } {
    const backend = new MockTerminalBackend();
    backend.hostColors = hostColors;
    const lifecycle = new LifecycleService(new DialogService());
    lifecycle.setPhase("restored");
    return { colors: new TerminalColorsService(themeService, configuration, backend, lifecycle), backend };
}
