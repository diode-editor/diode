import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken, token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";

import { registerVscodeDiffCommand } from "./compareActions.ts";

export const VscodeDiffCommandContributionDIToken = token<VscodeDiffCommandContribution>(
    "VscodeDiffCommandContribution",
);

/** The extension host runs `vscode.diff` by id over the bridge, so the command must exist before extensions start (`blockStartup`). */
export class VscodeDiffCommandContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [CommandRegistryDIToken, ServiceAccessorDIToken] as const;

    public constructor(commands: CommandRegistry, accessor: ServiceAccessor) {
        super();
        this.register(registerVscodeDiffCommand(commands, accessor));
    }
}
