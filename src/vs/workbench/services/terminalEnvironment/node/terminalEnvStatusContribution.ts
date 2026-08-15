import { Disposable } from "@tuidom/core/common/disposable";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStatusBarEntryHandle } from "../../statusbar/common/statusBarService.ts";
import type { StatusBarService } from "../../statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../statusbar/common/statusBarService.ts";

import type { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";
import { TerminalEnvironmentServiceDIToken } from "./terminalEnvironmentService.ts";

export const TerminalEnvStatusContributionDIToken = token<TerminalEnvStatusContribution>(
    "TerminalEnvStatusContribution",
);

/**
 * Публикует в {@link StatusBarService} компактный индикатор терминального
 * окружения (первый слева): tier + активные моды кроме неявного `local`
 * (например "kitty", "csi-u · ssh,tmux"). Подсказывает пользователю, что
 * терминал можно проапгрейдить. Обновляется по `onDidChange` сервиса
 * (finalize пробы / переключение мода).
 */
export class TerminalEnvStatusContribution extends Disposable {
    public static dependencies = [StatusBarServiceDIToken, TerminalEnvironmentServiceDIToken] as const;

    private readonly handle: IStatusBarEntryHandle;

    public constructor(
        statusBar: StatusBarService,
        private readonly terminalEnv: TerminalEnvironmentService,
    ) {
        super();
        this.handle = this.register(
            statusBar.addEntry({
                id: "status.terminalEnvironment",
                name: "Terminal Environment",
                text: this.segmentText(),
                alignment: "left",
                priority: 100,
            }),
        );
        this.register(
            this.terminalEnv.onDidChange(() => {
                this.handle.update({ text: this.segmentText() });
            }),
        );
    }

    private segmentText(): string {
        const modes = [...this.terminalEnv.getActiveModes()].filter((m) => m !== "local").sort();
        const suffix = modes.length > 0 ? ` · ${modes.join(",")}` : "";
        return `${this.terminalEnv.tier}${suffix}`;
    }
}
