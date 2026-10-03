import { Disposable } from "../../../../base/common/lifecycle.ts";
import { registerContextKeys } from "../../../../platform/contextkey/common/contextKeys.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { applyTerminalEnvContextKeys, modeContextKey } from "../common/terminalEnvContextKeys.ts";

import { ALL_CAPABILITIES } from "./terminalEnvironmentModel.ts";
import type { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";

export const TerminalEnvContextKeysContributionDIToken = token<TerminalEnvContextKeysContribution>(
    "TerminalEnvContextKeysContribution",
);

/**
 * Держит when-ключи терминального окружения (tier / os / cap_* / mode_* /
 * macKeys) в синхроне с {@link TerminalEnvironmentService}. Окружение меняется
 * только событием сервиса (finalize пробы, переключение мода, рунг по первому
 * Cmd), поэтому ключи пушатся по `onDidChange`, а не пересчитываются перед
 * каждым нажатием. Маппинг — общий с Keyboard Doctor
 * ({@link applyTerminalEnvContextKeys}).
 */
export class TerminalEnvContextKeysContribution extends Disposable {
    public static dependencies = [ContextKeyServiceDIToken, TerminalEnvironmentServiceDIToken] as const;

    public constructor(
        private readonly contextKeys: ContextKeyService,
        private readonly terminalEnv: TerminalEnvironmentService,
    ) {
        super();
        // Имена своих модов (mode_<name>) — валидные идентификаторы `when`.
        registerContextKeys(this.terminalEnv.getKnownModeNames().map(modeContextKey));
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
