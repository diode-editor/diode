import type { ITerminalBackend } from "@tuidom/all/backend/iTerminalBackend";
import type { ContainerModule } from "../../../../platform/instantiation/common/diContainer.ts";
import { TerminalBackendDIToken } from "../../../common/coreTokens.ts";

import { TerminalEnvironmentService, TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";

export interface TerminalEnvironmentModuleContext {
    backend: ITerminalBackend;
}

/**
 * Binds the terminal backend (so the env service can probe it) and the
 * TerminalEnvironmentService itself.
 */
export const terminalEnvironmentModule: ContainerModule<TerminalEnvironmentModuleContext> = (
    container,
    { backend },
) => {
    container.bind(TerminalBackendDIToken, () => backend);
    container.bind(TerminalEnvironmentServiceDIToken, TerminalEnvironmentService);
};
