import type { ITerminalBackend } from "@tuidom/core/backend/iTerminalBackend";

import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { ContainerModule } from "../../../../platform/instantiation/common/diContainer.ts";
import { TerminalBackendDIToken } from "../../../../platform/terminal/common/terminalBackendDIToken.ts";
import { ProductIconService, ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";

import { TerminalEnvironmentService, TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";
import { queryTmuxClient } from "./tmuxClientProbe.ts";

export interface TerminalEnvironmentModuleContext {
    backend: ITerminalBackend;
    /** `$TERM`: the `auto` of `diode.icons.nerdFont` turns the glyphs off on the Linux console. */
    term?: string;
    /** Turns the keyboard protocols on in the real terminal (the Mac exception); absent — nothing to switch. */
    enableExtendedKeys?: () => void;
}

export const terminalEnvironmentModule: ContainerModule<TerminalEnvironmentModuleContext> = (
    container,
    { backend, term, enableExtendedKeys },
) => {
    container.bind(TerminalBackendDIToken, () => backend);
    container.bind(
        TerminalEnvironmentServiceDIToken,
        () =>
            new TerminalEnvironmentService(
                backend,
                container.get(IConfigurationServiceDIToken),
                queryTmuxClient,
                enableExtendedKeys,
            ),
    );
    container.bind(
        ProductIconServiceDIToken,
        () => new ProductIconService(container.get(IConfigurationServiceDIToken), term),
    );
};
