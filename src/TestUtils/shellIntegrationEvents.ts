import type { IExtensionTerminalShellIntegrationEvents } from "../vs/workbench/api/common/iExtensionWindowSinks.ts";

/** The shell integration part of a terminal subscriber, for tests that don't look at it. */
export const IGNORED_SHELL_INTEGRATION_EVENTS: IExtensionTerminalShellIntegrationEvents = {
    shellIntegrationChanged: () => undefined,
    shellIntegrationCwd: () => undefined,
    shellIntegrationEnv: () => undefined,
    shellExecutionStart: () => undefined,
    shellExecutionData: () => undefined,
    shellExecutionEnd: () => undefined,
};
