import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { applyTerminalEnvContextKeys } from "../common/terminalEnvContextKeys.ts";

import { ALL_CAPABILITIES } from "./terminalEnvironmentModel.ts";
import type { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";

export const TerminalEnvContextKeysContributionDIToken = token<TerminalEnvContextKeysContribution>(
    "TerminalEnvContextKeysContribution",
);

/**
 * The environment changes only through a service event (probe finalize, mode, rung on the first Cmd),
 * so keys are pushed on `onDidChange` rather than recomputed before every keypress.
 */
export class TerminalEnvContextKeysContribution extends Disposable {
    public static dependencies = [ContextKeyServiceDIToken, TerminalEnvironmentServiceDIToken] as const;

    public constructor(
        private readonly contextKeys: ContextKeyService,
        private readonly terminalEnv: TerminalEnvironmentService,
    ) {
        super();
        this.push();
        this.register(
            this.terminalEnv.onDidChange(() => {
                this.push();
            }),
        );
    }

    private push(): void {
        const env = this.terminalEnv;
        applyTerminalEnvContextKeys(this.contextKeys, {
            tier: env.tier,
            os: env.os,
            macKeysRung: env.macKeysRung,
            capabilities: Object.fromEntries(ALL_CAPABILITIES.map((cap) => [cap, env.hasCapability(cap)])),
            modes: Object.fromEntries(env.getKnownModeNames().map((name) => [name, env.isModeActive(name)])),
        });
    }
}
