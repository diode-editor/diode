import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContainerModule } from "../../../../platform/instantiation/common/diContainer.ts";
import { TerminalBackendDIToken } from "../../../../platform/terminal/common/terminalBackendDIToken.ts";
import { ProductIconService, ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";

import { TerminalEnvironmentService, TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";

export interface TerminalEnvironmentModuleContext {
    backend: ITerminalBackend;
    /** `$TERM`: the `auto` of `diode.icons.nerdFont` turns the glyphs off on the Linux console. */
    term?: string;
}

export const terminalEnvironmentModule: ContainerModule<TerminalEnvironmentModuleContext> = (
    container,
    { backend, term },
) => {
    container.bind(TerminalBackendDIToken, () => backend);
    container.bind(TerminalEnvironmentServiceDIToken, TerminalEnvironmentService);
    container.bind(
        ProductIconServiceDIToken,
        () => new ProductIconService(container.get(IConfigurationServiceDIToken), term),
    );
};
